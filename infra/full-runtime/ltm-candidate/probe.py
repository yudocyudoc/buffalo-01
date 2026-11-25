"""Offline admission experiment, not a production simulator or a new LTM implementation."""
from __future__ import annotations

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
from simlin import Aux, Flow, Stock
from product_attribution import product_link_score

VERSION = "0.8.5"
REFERENCE = Path("/reference")
JSON_SHA = "60fb3e35df384901bd62aa213dd888ed1016688b0406629dc31a3e637b14f206"
STMX_SHA = "c92d2c8891fb865824f753723ed24510d999d8a4c88368cc36a6431f76fc4592"
LINK_ATOL = 1e-9
SHARE_ATOL = 1e-9
BASS_SCORE_ATOL_PP = 0.1
BASS_BOUNDARY = 9.625


def require(condition, reason):
    if not condition:
        raise AssertionError(reason)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def series(values, length, name):
    require(values is not None, "MISSING_SERIES:" + name)
    a = np.asarray(values, dtype=float)
    require(a.shape == (length,) and np.isfinite(a).all(), "INVALID_SERIES:" + name)
    return a


def close(a, b, atol=LINK_ATOL, rtol=0):
    return bool(np.allclose(a, b, atol=atol, rtol=rtol))


def max_error(a, b):
    return float(np.max(np.abs(np.asarray(a) - np.asarray(b))))


def canonical(name):
    return re.sub(r"\s+", "_", str(name).strip().casefold())


def cycle(names):
    nodes = tuple(canonical(x) for x in names)
    if len(nodes) > 1 and nodes[0] == nodes[-1]:
        nodes = nodes[:-1]
    require(len(nodes) > 0 and len(set(nodes)) == len(nodes), "INVALID_CYCLE")
    return min(nodes[i:] + nodes[:i] for i in range(len(nodes)))


def column(frame, name, n):
    matches = [c for c in frame.columns if canonical(c) == canonical(name)]
    require(len(matches) == 1, "MISSING_OR_AMBIGUOUS_VARIABLE:" + name)
    return series(frame[matches[0]], n, name)


def paper_model(aggregated):
    # Reproduce the step-input example in the pinned Simlin source's 2023
    # regression. 0*s closes inert feedback paths so exhaustive mode scores
    # these edges; it does not change the model equations' numerical behavior.
    p = simlin.Project.new(name="paper_aggregated" if aggregated else "paper_separate",
                           sim_start=0.0, sim_stop=5.0, dt=1.0)
    model = p.main_model
    with model.edit() as (_, patch):
        if aggregated:
            patch.upsert(Stock(name="s", initial_equation="100", inflows=["net"], outflows=[]))
            patch.upsert(Aux(name="inflow", equation="5 + STEP(5, 2) + 0 * s"))
            patch.upsert(Aux(name="outflow", equation="4 + STEP(1, 2) + 0 * s"))
            patch.upsert(Flow(name="net", equation="inflow - outflow"))
        else:
            patch.upsert(Stock(name="s", initial_equation="100", inflows=["inflow"], outflows=["outflow"]))
            patch.upsert(Flow(name="inflow", equation="5 + STEP(5, 2) + 0 * s"))
            patch.upsert(Flow(name="outflow", equation="4 + STEP(1, 2) + 0 * s"))
    return model


def observe_paper(aggregated):
    model = paper_model(aggregated)
    with model.simulate(enable_ltm=True) as sim:
        sim.run_to_end()
        run = sim.get_run()
        frame = run.results
        require(run.ltm_mode == "exhaustive", "PAPER_NOT_EXHAUSTIVE")
        time = series(frame.index, 6, "time")
        require(np.array_equal(time, np.arange(6)), "PAPER_TIME_GRID")
        edges = [(x.from_var, x.to_var, x.score) for x in sim.get_links()]
        def raw(a, b):
            matching = [score for u, v, score in edges if (u, v) == (a, b)]
            require(len(matching) == 1, "MISSING_OR_AMBIGUOUS_LINK:" + a + "->" + b)
            return series(matching[0], 6, a + "->" + b)
        target = "net" if aggregated else "s"
        result = {"time": time.tolist(), "stock": column(frame, "s", 6).tolist(),
                  "inflow": column(frame, "inflow", 6).tolist(),
                  "outflow": column(frame, "outflow", 6).tolist(),
                  "inflow_link": raw("inflow", target).tolist(),
                  "outflow_link": raw("outflow", target).tolist()}
        if aggregated:
            result["net_link"] = raw("net", "s").tolist()
            result["net"] = column(frame, "net", 6).tolist()
        return result


def paper_test():
    dis, agg = observe_paper(False), observe_paper(True)
    expected_in = [0, 0, 1.25, 0, 0, 0]
    expected_out = [0, 0, -0.25, 0, 0, 0]
    expected_stock = [100, 101, 102, 107, 112, 117]
    checks = {
        "input_values": all(close(x["inflow"], [5, 5, 10, 10, 10, 10])
                            and close(x["outflow"], [4, 4, 5, 5, 5, 5]) for x in [dis, agg]),
        "euler_stock": all(close(x["stock"], expected_stock) for x in [dis, agg]),
        "direct_raw_in": close(dis["inflow_link"], expected_in),
        "direct_raw_out": close(dis["outflow_link"], expected_out),
        "aggregate_raw_in": close(agg["inflow_link"], expected_in),
        "aggregate_raw_out": close(agg["outflow_link"], expected_out),
        "aggregate_net": close(agg["net"], [1, 1, 5, 5, 5, 5]),
        "in_path_equivalence": close(dis["inflow_link"], np.array(agg["inflow_link"]) * np.array(agg["net_link"])),
        "out_path_equivalence": close(dis["outflow_link"], np.array(agg["outflow_link"]) * np.array(agg["net_link"])),
        "net_link_at_change": math.isclose(agg["net_link"][2], 1, abs_tol=LINK_ATOL, rel_tol=0),
    }
    return {"checks": checks, "passed": all(checks.values()), "disaggregated": dis,
            "aggregated": agg, "expected_raw_in": expected_in, "expected_raw_out": expected_out}


def births_deaths_test():
    p = simlin.Project.new(name="births_deaths", sim_start=0.0, sim_stop=10.0, dt=1.0)
    model = p.main_model
    with model.edit() as (_, patch):
        patch.upsert(Stock(name="a", initial_equation="100", inflows=["births"], outflows=["deaths"]))
        patch.upsert(Flow(name="births", equation="0.1 * a"))
        patch.upsert(Flow(name="deaths", equation="a / 20"))
    run = model.run(analyze_loops=True)
    require(run.ltm_mode == "exhaustive", "BIRTHS_NOT_EXHAUSTIVE")
    require(np.array_equal(series(run.results.index, 11, "time"), np.arange(11)), "BIRTHS_GRID")
    loops = {cycle(l.variables): l for l in run.loops}
    require(len(run.loops) == len(loops) == 2, "BIRTHS_LOOP_COUNT")
    r, b = loops[cycle(["a", "births"])], loops[cycle(["a", "deaths"])]
    rs = series(r.behavior_time_series, 11, "births")
    bs = series(b.behavior_time_series, 11, "deaths")
    checks = {
        "same_partition": r.partition is not None and r.partition == b.partition,
        "polarity": str(r.polarity) == "R" and str(b.polarity) == "B",
        "two_thirds": close(rs, [0] + [2/3] * 10, SHARE_ATOL),
        "negative_one_third": close(bs, [0] + [-1/3] * 10, SHARE_ATOL),
        "trajectory": close(column(run.results, "a", 11), 100 * (1.05 ** np.arange(11)), 1e-8, 1e-12),
    }
    return {"checks": checks, "passed": all(checks.values()), "signed_reinforcing": rs.tolist(),
            "signed_balancing": bs.tolist()}


# The original Stella file has unsigned AI metadata that the pinned Simlin
# deserializer rejects (missing keyurl). Remove only that exact byte range
# in a disposable copy; never modify the source or invent signature fields.
def bass_import_copy(model_file, directory):
    original = model_file.read_bytes()
    require(hashlib.sha256(original).hexdigest() == STMX_SHA, "REFERENCE_BYTES_CHANGED")
    block = (b'\t<ai_information>\n'
             b'\t\t<status verified="false"/>\n'
             b'\t\t<settings>\n'
             b'\t\t\t<isee:setting key="problemStatement" value=""/>\n'
             b'\t\t\t<isee:setting key="quantitative/backgroundKnowledge" value=""/>\n'
             b'\t\t</settings>\n'
             b'\t</ai_information>\n')
    require(original.count(block) == 1, "UNEXPECTED_UNSIGNED_METADATA")
    offset = original.index(block)
    derived = original[:offset] + original[offset + len(block):]
    require(derived[:offset] + block + derived[offset:] == original, "IMPORT_COPY_BYTE_DRIFT")
    root = ET.fromstring(original)
    ns = "{http://docs.oasis-open.org/xmile/ns/XMILE/v1.0}"
    metadata = root.findall(ns + "ai_information")
    require(len(metadata) == 1, "UNEXPECTED_METADATA_COUNT")
    root.remove(metadata[0])
    require(ET.tostring(root) == ET.tostring(ET.fromstring(derived)), "IMPORT_COPY_XML_DRIFT")
    target = Path(directory) / "bassDiffusion.import.xmile"
    target.write_bytes(derived)
    return target, {"kind": "unsigned-ai-metadata-only-removal",
                    "source_sha256": STMX_SHA,
                    "derived_sha256": digest(target),
                    "removed_sha256": hashlib.sha256(block).hexdigest(),
                    "removed_bytes": len(block), "offset": offset,
                    "reversible": True}
    
def bass_product_attribution(run, links, model_file):
    """Compute from XMILE equations and measured Simlin data, before loading the score reference."""
    frame = run.results
    n = len(frame)
    edges_by_loop = {}
    for loop in run.loops:
        nodes = list(cycle(loop.variables))
        edges_by_loop[loop.id] = list(zip(nodes, nodes[1:] + nodes[:1]))
    needed = set().union(*edges_by_loop.values())
    raw = {}
    for link in links:
        edge = (canonical(link.from_var), canonical(link.to_var))
        if edge in needed:
            require(edge not in raw, "DUPLICATE_LOOP_EDGE")
            raw[edge] = series(link.score, n, str(edge))
    require(raw.keys() == needed, "INCOMPLETE_RAW_LOOP_LINKS")
    require(len(run.loops) == 2 and run.loops[0].partition is not None
            and run.loops[0].partition == run.loops[1].partition, "EXPECTED_ONE_BASS_PARTITION")

    def relative_scores(scores):
        products = {key: np.prod([scores[e] for e in edges], axis=0)
                    for key, edges in edges_by_loop.items()}
        total = np.sum([np.abs(p) for p in products.values()], axis=0)
        return {key: np.divide(p, total, out=np.zeros(n), where=total != 0)
                for key, p in products.items()}

    native = relative_scores(raw)
    for loop in run.loops:
        require(close(native[loop.id], loop.behavior_time_series, SHARE_ATOL), "RAW_LOOP_RECONSTRUCTION")

    # The pinned scalar Bass model has one auxiliary where two feedback paths
    # enter a product. Read its factors from the model, keeping all other raw links.
    adjusted = raw.copy()
    products = []
    ns = {"x": "http://docs.oasis-open.org/xmile/ns/XMILE/v1.0"}
    for aux in ET.parse(model_file).findall("x:model/x:variables/x:aux", ns):
        target = canonical(aux.attrib["name"].replace(r"\n", " "))
        equation = (aux.findtext("x:eqn", default="", namespaces=ns)).strip()
        factors = re.fullmatch(r"(\w+)\s*\*\s*(\w+)", equation)
        if not factors:
            continue
        x, y = map(canonical, factors.groups())
        if (x, target) not in raw or (y, target) not in raw:
            continue
        require(x != y, "EXPECTED_DISTINCT_FACTORS")
        z = column(frame, target, n)
        xv, yv = column(frame, x, n), column(frame, y, n)
        require(close(z, xv * yv, 0, 1e-12), "PRODUCT_TRAJECTORY")
        for source, values, held in [(x, xv, yv), (y, yv, xv)]:
            first = product_link_score(values, held, z, changed_last=False)
            require(close(first, raw[source, target], 1e-8, 1e-8), "NATIVE_PRODUCT_ATTRIBUTION")
            adjusted[source, target] = product_link_score(values, held, z, changed_last=True)
        products.append({"target": target, "factors": [x, y]})
    require(len(products) == 1, "EXPECTED_ONE_BASS_MIXED_PRODUCT")
    return relative_scores(adjusted), products


def bass_test():
    ref_file, model_file = REFERENCE / "bassDiffusion.json", REFERENCE / "bassDiffusion.stmx"
    require(digest(ref_file) == JSON_SHA and digest(model_file) == STMX_SHA, "REFERENCE_BYTES_CHANGED")
    with tempfile.TemporaryDirectory(prefix='bass-ltm-') as directory:
        import_file, import_provenance = bass_import_copy(model_file, directory)
        model = simlin.load(import_file)
        with model.simulate(enable_ltm=True) as sim:
            sim.run_to_end()
            run = sim.get_run()
            links = sim.get_links()
    require(run.ltm_mode == "exhaustive", "BASS_NOT_EXHAUSTIVE")
    time = series(run.results.index, 241, "time")
    require(np.array_equal(time, np.arange(241) / 16), "BASS_TIME_GRID")
    loops = {cycle(l.variables): l for l in run.loops}
    require(len(run.loops) == len(loops) == 2, "BASS_LOOP_COUNT")
    adapted, products = bass_product_attribution(run, links, model_file)
    reference = json.loads(ref_file.read_text(encoding="utf-8"))["feedback"]["feedbackLoops"]
    measured = {}
    for entry in reference:
        sig = cycle([link["from"] for link in entry["links"]])
        require(sig in loops, "BASS_MISSING_DIRECTED_CYCLE:" + entry["identifier"])
        lp = loops[sig]
        signed = series(lp.behavior_time_series, 241, lp.id)
        points = entry["Percent of Model Behavior Explained by Loop"]
        require([p["time"] for p in points] == time.tolist(), "REFERENCE_SCORE_GRID")
        expected = series([p["value"] for p in points], 241, "reference " + entry["identifier"])
        measured[entry["identifier"]] = {
            "backend_id": lp.id, "variables": list(lp.variables), "partition": lp.partition,
            "polarity": str(lp.polarity), "signed_relative_scores": signed.tolist(),
            "reference_percent": expected.tolist(),
            "max_error_pp": max_error(100 * np.abs(signed), expected),
            "changed_last_signed_relative_scores": adapted[lp.id].tolist(),
            "changed_last_max_error_pp": max_error(100 * np.abs(adapted[lp.id]), expected),
        }
    r, b = measured["R1"], measured["B1"]
    rs, bs = np.array(r["signed_relative_scores"]), np.array(b["signed_relative_scores"])
    transitions = [float(time[i]) for i in range(1, len(time)) if bs[i] < -0.5 and bs[i-1] >= -0.5]
    adopters = column(run.results, "Adopters", 241)
    potentials = column(run.results, "Potential Adopters", 241)
    adopting = column(run.results, "adopting", 241)
    # Independent Euler recurrence from the original equations; this is a
    # trajectory oracle, not a second implementation of LTM.
    a = [1.0]
    for _ in range(240):
        a.append(a[-1] + (1/16) * 1.5 * a[-1] * (1000000 - a[-1]) / 1000000)
    a = np.array(a)
    checks = {
        "same_partition": r["partition"] is not None and r["partition"] == b["partition"],
        "polarity": r["polarity"] == "R" and b["polarity"] == "B",
        "signed_ranges": bool(np.all((rs >= 0) & (rs <= 1)) and np.all((bs >= -1) & (bs <= 0))),
        "zero_initial_scores": bool(rs[0] == 0 and bs[0] == 0),
        "relative_normalization": close(np.abs(rs[1:]) + np.abs(bs[1:]), np.ones(240), SHARE_ATOL),
        "dominance_boundary": transitions == [BASS_BOUNDARY],
        "all_samples_match_reference": max(r["max_error_pp"], b["max_error_pp"]) <= BASS_SCORE_ATOL_PP,
        "adopters_euler": close(adopters, a, 1e-6, 1e-10),
        "potential_adopters_euler": close(potentials, 1000000-a, 1e-6, 1e-10),
        "adoption_flow": close(adopting, 1.5 * a * (1000000-a)/1000000, 1e-6, 1e-10),
        "source_unchanged": digest(ref_file) == JSON_SHA and digest(model_file) == STMX_SHA,
    }
    cr = np.array(r["changed_last_signed_relative_scores"])
    cb = np.array(b["changed_last_signed_relative_scores"])
    # Check the whole dominance pattern, including the final sample.
    profile_checks = dict(checks)
    profile_checks.update(
        signed_ranges=bool(np.all((cr >= 0) & (cr <= 1)) and np.all((cb >= -1) & (cb <= 0))),
        zero_initial_scores=bool(cr[0] == 0 and cb[0] == 0),
        relative_normalization=close(np.abs(cr[1:]) + np.abs(cb[1:]), np.ones(240), SHARE_ATOL),
        dominance_boundary=bool(np.array_equal(cb[1:] < -0.5, time[1:] >= BASS_BOUNDARY)
                                and np.array_equal(cr[1:] > 0.5, time[1:] < BASS_BOUNDARY)),
        all_samples_match_reference=max(r["changed_last_max_error_pp"], b["changed_last_max_error_pp"]) <= BASS_SCORE_ATOL_PP,
    )
    return {"checks": checks, "passed": all(checks.values()), "time": time.tolist(),
            "changed_last": {"checks": profile_checks, "passed": all(profile_checks.values()), "products": products,
                             "balancing_transitions": time[1:][(cb[1:] < -0.5) & (cb[:-1] >= -0.5)].tolist()},
            "import_provenance": import_provenance, "loops": measured, "balancing_transitions": transitions,
            "backend_periods": [{"start": float(p.start_time), "end": float(p.end_time),
                                 "loops": list(p.dominant_loops)} for p in run.dominant_periods],
            "trajectory": {"Adopters": adopters.tolist(), "Potential Adopters": potentials.tolist(),
                           "adopting": adopting.tolist()},
            "max_trajectory_error_adopters": max_error(adopters, a)}


def main():
    report = {"status": "EXECUTION_FAILURE", "source_kind": "simlin-candidate-computation",
              "pysimlin_version": md.version("pysimlin"),
              "python": platform.python_version(), "platform": platform.platform(),
              "dependencies": sorted({d.metadata["Name"] + "==" + d.version for d in md.distributions()}),
              "reference": {"json_sha256": JSON_SHA, "stmx_sha256": STMX_SHA},
              "tolerances": {"raw_link_abs": LINK_ATOL, "relative_share_abs": SHARE_ATOL,
                             "bass_score_abs_percentage_points": BASS_SCORE_ATOL_PP,
                             "bass_transition_expected": BASS_BOUNDARY,
                             "trajectory_atol": 1e-6, "trajectory_rtol": 1e-10}}
    stage = "version"
    try:
        require(report["pysimlin_version"] == VERSION, "UNEXPECTED_BACKEND_VERSION")
        stage = "paper_tables_2_3"
        report[stage] = paper_test()
        stage = "births_deaths"
        report[stage] = births_deaths_test()
        stage = "bass"
        report[stage] = bass_test()
        controls_pass = report["paper_tables_2_3"]["passed"] and report["births_deaths"]["passed"]
        report["native_status"] = "CANDIDATE_PASS" if controls_pass and report["bass"]["passed"] else "NUMERICAL_MISMATCH"
        report["status"] = ("BASS_PRODUCT_PROFILE_PASS" if controls_pass and report["bass"]["changed_last"]["passed"]
                            else "NUMERICAL_MISMATCH")
    except Exception as e:
        report["failure_stage"] = stage
        report["error"] = type(e).__name__ + ": " + str(e)
    print(json.dumps(report, allow_nan=False, indent=2))
    return 0 if report["status"] == "BASS_PRODUCT_PROFILE_PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
