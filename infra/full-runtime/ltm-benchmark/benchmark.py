"""Native Simlin measurement; not an adapter or a production admission gate."""
import hashlib
import importlib.metadata as md
import json
import math
from pathlib import Path
import platform
import re
import sys
import tempfile
import xml.etree.ElementTree as ET

import numpy as np
import simlin

HERE = Path(__file__).parent
MANIFEST = json.loads((HERE / "manifest.json").read_text())
REF = Path("/reference")
WHOLE = "Percent of Model Behavior Explained by Loop"
SET = "Percent of this Feedback Loop Set Behavior Explained by Loop"
NS = "{http://docs.oasis-open.org/xmile/ns/XMILE/v1.0}"
TOL_PP = 0.1  # inherited provisional Bass threshold, no claim of certified accuracy
NORM_TOL_PP = 1e-7


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def blob(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()


def canonical(name):
    return re.sub(r"\s+", "_", str(name).strip().casefold())


def cycle(nodes):
    nodes = tuple(map(canonical, nodes))
    if len(nodes) > 1 and nodes[0] == nodes[-1]:
        nodes = nodes[:-1]
    require(bool(nodes) and len(set(nodes)) == len(nodes), "invalid directed cycle")
    return min(nodes[i:] + nodes[:i] for i in range(len(nodes)))


def reference_cycle(links):
    require(bool(links), "empty reference cycle")
    require(all(canonical(e["to"]) == canonical(links[(i+1) % len(links)]["from"])
                for i, e in enumerate(links)), "reference links do not form a directed cycle")
    return cycle([e["from"] for e in links])


def array(values, n):
    a = np.asarray(values, dtype=float)
    require(a.shape == (n,) and np.isfinite(a).all(), "nonfinite or malformed series")
    return a


def grid_indices(native, reference):
    # Exact timestamps only. No nearest match, shifting, interpolation or averaging.
    index = {t: i for i, t in enumerate(native)}
    require(len(index) == len(native), "duplicate native timestamp")
    return [index[t] for t in reference] if all(t in index for t in reference) else None


def reference_data(data):
    f = data["feedback"]
    require(f["valid"] is True, "invalid reference feedback")
    loops, groups, grid = {}, {}, None
    for l in f["feedbackLoops"]:
        keys = [k for k in (WHOLE, SET) if k in l]
        require(len(keys) == 1, "ambiguous denominator")
        group = "whole-model" if keys[0] == WHOLE else l["loopset"]
        require(isinstance(group, str) and group, "invalid loop set")
        points = l[keys[0]]
        times = [p["time"] for p in points]
        require(bool(times) and all(math.isfinite(t) for t in times) and
                all(a < b for a, b in zip(times, times[1:])), "invalid reference grid")
        if grid is None:
            grid = times
        require(times == grid, "different reference grids")
        sig = reference_cycle(l["links"])
        require(sig not in loops, "duplicate directed reference cycle")
        scores = array([p["value"] for p in points], len(grid))
        require(np.all((scores >= 0) & (scores <= 100)), "invalid reference percentage")
        require(l["polarity"] in ("+", "-", ""), "unknown reference polarity")
        loops[sig] = {"id": l["identifier"], "group": group, "polarity": l["polarity"], "scores": scores}
        groups.setdefault(group, set()).add(sig)
    require(bool(loops), "no reference loops")
    require("whole-model" not in groups or len(groups) == 1, "mixed reference denominators")
    return grid, loops, groups, f["dominantLoopsByPeriod"]


def partition_equivalence(reference_groups, native):
    partitions = {}
    for sig, l in native.items():
        partitions.setdefault(l["partition"], set()).add(sig)
    mapping = {}
    for name, cycles in reference_groups.items():
        matches = [p for p, members in partitions.items() if p is not None and cycles == members]
        if len(matches) != 1:
            return None
        mapping[name] = matches[0]
    return mapping if len(set(mapping.values())) == len(partitions) == len(reference_groups) else None


def xml_structure(element):
    # Ignore only whitespace-only formatting between elements. Preserve all
    # attributes and non-whitespace text (including equation text) exactly.
    def content(value):
        return None if value is None or not value.strip() else value
    return (element.tag, dict(element.attrib), content(element.text),
            content(element.tail), tuple(xml_structure(child) for child in element))


def safe_import_copy(original):
    """Only remove known unsigned, empty AI metadata; never signed logs or equations."""
    block = re.search(rb"\t<ai_information>\n.*?\n\t</ai_information>\n", original, re.S)
    if not block:
        return None
    known = [
        b'\t<ai_information>\n\t\t<status verified="false"/>\n\t\t<testing signed_message_body=""/>\n\t</ai_information>\n',
        b'\t<ai_information>\n\t\t<status verified="false"/>\n\t\t<settings>\n'
        b'\t\t\t<isee:setting key="problemStatement" value=""/>\n'
        b'\t\t\t<isee:setting key="quantitative/backgroundKnowledge" value=""/>\n'
        b'\t\t</settings>\n\t</ai_information>\n',
    ]
    removed = block.group()
    if removed not in known or original.count(removed) != 1:
        return None
    i = block.start()
    derived = original[:i] + original[block.end():]
    root = ET.fromstring(original)
    metadata = root.findall(NS + "ai_information")
    require(len(metadata) == 1, "unexpected AI metadata count")
    root.remove(metadata[0])
    require(xml_structure(root) == xml_structure(ET.fromstring(derived)), "nonmetadata XML change")
    require(derived[:i] + removed + derived[i:] == original, "nonreversible import")
    return derived, {"kind": "unsigned-empty-ai-metadata-only-removal",
                     "source_sha256": sha(original), "derived_sha256": sha(derived),
                     "removed_sha256": sha(removed), "offset": i, "removed_bytes": len(removed)}


def load_native(path, original, report):
    path.write_bytes(original)
    report["import"] = {"kind": "byte-identical-copy", "source_sha256": sha(original)}
    try:
        return simlin.load(path)
    except Exception as e:
        report["original_import_error"] = str(e)
        if "keyurl" not in str(e) or "missing field" not in str(e):
            raise
        fixed = safe_import_copy(original)
        if fixed is None:
            raise
        derived, provenance = fixed
        path.write_bytes(derived)
        report["import"] = provenance
        return simlin.load(path)


def xml_specs(data):
    root = ET.fromstring(data)
    s = root.find(NS + "sim_specs")
    require(s is not None, "missing XMILE simulation specs")
    dt = s.find(NS + "dt")
    require(dt is not None, "missing dt")
    step = float(dt.text)
    if dt.get("reciprocal") == "true":
        step = 1 / step
    return {"start": float(s.findtext(NS + "start")), "stop": float(s.findtext(NS + "stop")),
            "dt": step, "attributes": dict(s.attrib)}


def prepare_source_xml(name, original, report):
    """Repair only the byte-pinned Mai-Bab display attribute, never model semantics."""
    try:
        report["source_specs"] = xml_specs(original)
        report["source_specs_origin"] = "original"
        return original
    except ET.ParseError as error:
        report["original_xml_error"] = {"message": str(error), "position": list(error.position)}
        if name != "maibab":
            raise
        require(blob(original) == MANIFEST["fixtures"]["maibab"][1], "Mai-Bab source drift")
        require(error.position == (237, 526), "unexpected XML parse position")
        bad = b' header_font_family="\xd0R^\xff\x7f"'
        require(original.count(bad) == 1, "unexpected corrupt attribute count")
        offset = original.index(bad)
        require(offset == 17656, "unexpected corrupt attribute offset")
        start = original.rfind(b"<table ", 0, offset)
        end = original.find(b"/>", offset)
        require(start >= 0 and end > offset and b"<" not in original[start+1:end]
                and b">" not in original[start:end], "not a self-closing table attribute")
        derived = original[:offset] + original[offset+len(bad):]
        require(derived[:offset] + bad + derived[offset:] == original, "nonreversible view repair")
        root = ET.fromstring(derived)
        table = ET.fromstring(b'<wrapper xmlns:isee="http://iseesystems.com/XMILE">' +
                              derived[start:end-len(bad)+2] + b'</wrapper>')[0]
        # Confirm that the exact remaining table attributes belong to a model view style.
        candidates = root.findall(NS + "model/" + NS + "views/" + NS + "view/" + NS + "style/" + NS + "table")
        require(sum(t.attrib == table.attrib for t in candidates) == 1, "table not uniquely identified in view style")
        report["view_repair"] = {"kind": "maibab-invalid-view-font-attribute-removal",
                                 "source_sha256": sha(original), "derived_sha256": sha(derived),
                                 "removed_sha256": sha(bad), "removed_hex": bad.hex(),
                                 "offset": offset, "removed_bytes": len(bad), "reversible": True}
        report["source_specs"] = xml_specs(derived)
        report["source_specs_origin"] = "view-attribute-only-derived-copy"
        return derived


def native_period_check(grid, reference_periods, backend_periods, reference, native):
    # SD-AI's flat period IDs are ambiguous for multiple sets (B1/R1 reused).
    # Never silently assign these to a partition.
    ids = [l["id"] for l in reference.values()]
    if len(set(ids)) != len(ids) or len({l["group"] for l in reference.values()}) != 1:
        return {"status": "unverified_multi_set_period_scope"}
    id_by_backend = {native[sig]["id"]: reference[sig]["id"] for sig in reference}
    diffs, gaps, checked = [], [], 0
    for t in grid[1:]:
        active = [p for p in reference_periods if p["startTime"] <= t <= p["endTime"]]
        if not active:
            gaps.append(t)
            continue
        # Shared reference boundaries belong to the period starting there.
        want = sorted(active[-1]["dominantLoops"])
        found = [p for p in backend_periods if p["start"] <= t <= p["end"]]
        if len(found) != 1 or any(k not in id_by_backend for k in found[0]["loops"]):
            gaps.append(t)
            continue
        actual = sorted(id_by_backend[k] for k in found[0]["loops"])
        checked += 1
        if actual != want:
            diffs.append({"time": t, "reference": want, "native": actual})
    return {"status": "match" if checked and not diffs and not gaps else "mismatch_or_uncovered",
            "checked": checked, "mismatches": diffs, "uncovered_times": gaps}


def compare(grid, reference, groups, periods, native_time, native, native_periods, report):
    missing, extra = set(reference) - set(native), set(native) - set(reference)
    report["topology"] = {"reference_count": len(reference), "native_count": len(native),
                          "matched_count": len(set(reference) & set(native)),
                          "missing": [list(s) for s in sorted(missing)],
                          "extra": [list(s) for s in sorted(extra)]}
    positions = grid_indices(native_time, grid)
    report["grid"] = {"reference_count": len(grid), "native_count": len(native_time),
                      "exact": grid == native_time, "reference_subset": positions is not None}
    mapping = partition_equivalence(groups, native)
    report["denominator_mapping"] = mapping
    report["loop_comparisons"] = []
    for sig in sorted(set(reference) & set(native)):
        ref, got = reference[sig], native[sig]
        entry = {"cycle": list(sig), "reference_id": ref["id"], "reference_group": ref["group"],
                 "native_id": got["id"], "native_partition": got["partition"],
                 "reference_polarity": ref["polarity"], "native_polarity": got["polarity"],
                 "exact_polarity_label": {"+": "R", "-": "B", "": "U"}[ref["polarity"]] == got["polarity"]}
        # Whole-model vs partition shares are comparable only if cycle membership agrees.
        if positions is not None and mapping is not None:
            signed = got["scores"][positions]
            error = np.abs(100 * np.abs(signed) - ref["scores"])
            entry.update(max_error_pp=float(np.max(error)), rmse_pp=float(np.sqrt(np.mean(error**2))),
                         samples=len(error), worst_time=grid[int(np.argmax(error))])
        report["loop_comparisons"].append(entry)
    if positions is None or mapping is None or missing or extra:
        report["status"] = "NOT_COMPARABLE_GRID_OR_TOPOLOGY_OR_DENOMINATOR"
        return
    normalizations = {}
    for group, members in groups.items():
        a = np.sum([reference[s]["scores"] for s in members], axis=0)
        b = np.sum([100 * np.abs(native[s]["scores"][positions]) for s in members], axis=0)
        # Zero (no measured change) and 100 are valid; zero vs active is still a score mismatch.
        normalizations[group] = {"reference_max_error_pp": float(np.max(np.minimum(np.abs(a), np.abs(a-100)))),
                                 "native_max_error_pp": float(np.max(np.minimum(np.abs(b), np.abs(b-100))))}
    report["normalization"] = normalizations
    report["period_comparison"] = native_period_check(grid, periods, native_periods, reference, native)
    checks = {
        "exhaustive": report["ltm_mode"] == "exhaustive",
        "exact_polarity_labels": all(e["exact_polarity_label"] for e in report["loop_comparisons"]),
        "all_reference_samples_within_tolerance": all(e["max_error_pp"] <= TOL_PP for e in report["loop_comparisons"]),
        "normalization": all(max(x.values()) <= NORM_TOL_PP for x in normalizations.values()),
        "periods": report["period_comparison"]["status"] == "match",
    }
    report["checks"] = checks
    # This is evidence about native scores on the supplied clock, not an admission.
    report["status"] = ("NATIVE_SCORE_AND_PERIOD_MATCH_ON_REFERENCE_GRID" if all(checks.values())
                        else "NATIVE_MISMATCH_OR_UNVERIFIED")


def main(name):
    expected_json, expected_xml = MANIFEST["fixtures"][name]
    jf, xf = REF / (name + ".json"), REF / (name + ".stmx")
    jb, xb = jf.read_bytes(), xf.read_bytes()
    require(blob(jb) == expected_json and blob(xb) == expected_xml, "reference bytes changed")
    require(md.version("pysimlin") == "0.8.5", "backend version drift")
    data = json.loads(jb)
    grid, reference, groups, periods = reference_data(data)
    report = {"case": name, "status": "EXECUTION_FAILURE", "admitted": False,
              "source": {"json_git_blob": expected_json, "stmx_git_blob": expected_xml,
                         "json_sha256": sha(jb), "stmx_sha256": sha(xb)},
              "backend": md.version("pysimlin"), "python": platform.python_version(),
              "platform": platform.platform(),
              "dependencies": sorted(d.metadata["Name"] + "==" + d.version for d in md.distributions()),
              "score_tolerance_pp": TOL_PP, "normalization_tolerance_pp": NORM_TOL_PP,
              "reference_specs": data["model"]["specs"],
              "reference_time": grid, "reference_periods": periods,
              "reference_loops": [{"cycle": list(s), **{k: v for k, v in l.items() if k != "scores"},
                                   "percent": l["scores"].tolist()} for s, l in reference.items()]}
    stage = "source_xml_preflight"
    try:
        import_bytes = prepare_source_xml(name, xb, report)
        stage = "import"
        with tempfile.TemporaryDirectory() as tmp:
            model = load_native(Path(tmp) / (name + ".xmile"), import_bytes, report)
            stage = "imported_specs"
            report["imported_specs"] = json.loads(model.project.serialize_json())["simSpecs"]
            stage = "native_simulation"
            with model.simulate(enable_ltm=True) as sim:
                sim.run_to_end()
                run = sim.get_run()
                frame = run.results
                time = array(frame.index, len(frame)).tolist()
                require(bool(time) and all(a < b for a, b in zip(time, time[1:])), "invalid native grid")
                report["native_time"] = time
                report["trajectory"] = {str(c): array(frame[c], len(time)).tolist() for c in frame.columns}
                report["ltm_mode"] = run.ltm_mode
                stage = "native_loop_observation"
                native = {}
                for l in run.loops:
                    sig = cycle(l.variables)
                    require(sig not in native, "ambiguous native directed cycle")
                    native[sig] = {"id": l.id, "partition": l.partition, "polarity": str(l.polarity),
                                   "scores": array(l.behavior_time_series, len(time))}
                report["native_loops"] = [{"cycle": list(s), **{k: v for k,v in l.items() if k != "scores"},
                                          "signed_relative_scores": l["scores"].tolist()} for s,l in native.items()]
                report["native_periods"] = [{"start": float(p.start_time), "end": float(p.end_time),
                                             "partition": p.partition, "loops": list(p.dominant_loops)}
                                            for p in run.dominant_periods]
                stage = "comparison"
                compare(grid, reference, groups, periods, time, native, report["native_periods"], report)
    except Exception as e:
        report["status"] = "EXECUTION_FAILURE"
        report["failure_stage"] = stage
        report["error"] = type(e).__name__ + ": " + str(e)
    require(jf.read_bytes() == jb and xf.read_bytes() == xb, "source mutation")
    print(json.dumps(report, allow_nan=False, indent=2))


if __name__ == "__main__":
    main(sys.argv[1])
