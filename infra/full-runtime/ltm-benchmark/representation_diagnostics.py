"""Retrospective representation diagnostics; never alter the native benchmark verdict."""
import argparse
from collections import defaultdict
import hashlib
import json
import math
from pathlib import Path
import zipfile
import xml.etree.ElementTree as ET

HERE = Path(__file__).parent
NODE = "$⁚current_capacity⁚0⁚delay3"
NS = "{http://docs.oasis-open.org/xmile/ns/XMILE/v1.0}"
TOL = 0.1


def require(ok, message):
    if not ok:
        raise ValueError(message)


def cycle(nodes):
    nodes = tuple(nodes)
    require(nodes and len(set(nodes)) == len(nodes), "invalid cycle")
    return min(nodes[i:] + nodes[:i] for i in range(len(nodes)))


def index(loops, signature):
    result = {}
    for loop in loops:
        key = signature(loop["cycle"])
        require(key not in result, "ambiguous projected identity")
        result[key] = loop
    return result


def same_grid(d):
    require(d["reference_time"] == d["native_time"], "exact grid required")
    require(d["ltm_mode"] == "exhaustive" and d["admitted"] is False, "unexpected report")


def periods_for(d, refs, native, partition):
    by_id = {native[s]["id"]: r["id"] for s,r in refs.items()}
    require(len(set(by_id.values())) == len(refs) == len(by_id), "ambiguous IDs within selected group")
    active = [p for p in d["native_periods"] if p["partition"] == partition]
    result = {"matched": 0, "inactive": 0, "mismatches": [], "uncovered": []}
    for i,t in enumerate(d["reference_time"]):
        rp = [p for p in d["reference_periods"] if p["startTime"] <= t <= p["endTime"]]
        np = [p for p in active if p["start"] <= t <= p["end"]]
        a = sum(r["percent"][i] for r in refs.values())
        b = sum(abs(native[s]["signed_relative_scores"][i])*100 for s in refs)
        if a == 0 and b == 0:
            if np:
                result["mismatches"].append({"time":t,"reason":"native_period_on_inactive_sample"})
            else:
                result["inactive"] += 1
            continue
        if not rp or len(np) != 1 or any(k not in by_id for k in np[0]["loops"]):
            result["uncovered"].append(t)
            continue
        want = sorted(rp[-1]["dominantLoops"])
        actual = sorted(by_id[k] for k in np[0]["loops"])
        if want == actual:
            result["matched"] += 1
        else:
            result["mismatches"].append({"time":t,"reference":want,"native":actual})
    return result


def inventory(d):
    same_grid(d)
    require(d["case"] == "inventoryWorkforce", "wrong case")
    ref = index(d["reference_loops"], cycle)
    native = index(d["native_loops"], cycle)
    require(ref.keys() == native.keys(), "different cycles")
    groups = defaultdict(dict)
    for s,r in ref.items():
        groups[r["group"]][s] = r
    ids = {k for p in d["reference_periods"] for k in p["dominantLoops"]}
    # Determine scope from the complete ID vocabulary, independently of scores.
    candidates = [g for g,rs in groups.items()
                  if ids <= {r["id"] for r in rs.values()}]
    if len(candidates) != 1:
        return {"status":"AMBIGUOUS_PERIOD_SCOPE","candidates":candidates}
    group = candidates[0]
    rs = groups[group]
    partition = d["denominator_mapping"][group]
    require({s for s,l in native.items() if l["partition"] == partition} == rs.keys(),
            "partition membership differs")
    out = periods_for(d, rs, native, partition)
    return {"status":"UNIQUE_VOCABULARY_SCOPE_DIAGNOSTIC", "reference_group":group,
            "native_partition":partition, "reference_ids":sorted(ids),
            "other_groups_not_verified":sorted(set(groups)-{group}), **out}


def market(d, source):
    same_grid(d)
    require(d["case"] == "marketGrowth", "wrong case")
    require(hashlib.sha256(source).hexdigest() == d["source"]["stmx_sha256"], "source identity mismatch")
    root = ET.fromstring(source)
    eq = [v.findtext(NS+"eqn") for v in root.findall(NS+"model/"+NS+"variables/"+NS+"aux")
          if v.attrib["name"] == "current capacity"]
    require(eq == ["DELAY3(desired_capacity,Capacity_Acquisition_Delay,  Initial_Capacity)"],
            "unexpected DELAY3 equation")
    changes = []
    def project(nodes):
        if NODE not in nodes:
            return cycle(nodes)
        require(nodes.count(NODE) == 1, "repeated delay node")
        i = nodes.index(NODE)
        require(nodes[i-1] == "desired_capacity" and nodes[(i+1)%len(nodes)] == "current_capacity",
                "unexpected internal node context")
        projected = cycle([n for n in nodes if n != NODE])
        changes.append({"native_cycle":list(nodes),"projected_cycle":list(projected)})
        return projected
    ref = index(d["reference_loops"],cycle)
    native = index(d["native_loops"],project)
    require(ref.keys() == native.keys(), "projection does not yield a bijection")
    require({l["group"] for l in ref.values()} == {"whole-model"}, "wrong denominator")
    partitions = {l["partition"] for l in native.values()}
    require(len(partitions)==1 and None not in partitions,"native partitions differ")
    rows=[]
    for s,r in ref.items():
        n=native[s]
        require(len(n["signed_relative_scores"]) == len(r["percent"]) == len(d["reference_time"]), "series size")
        errors=[abs(abs(x)*100-y) for x,y in zip(n["signed_relative_scores"],r["percent"])]
        require(all(math.isfinite(e) for e in errors),"nonfinite error")
        mx=max(errors)
        rows.append({"reference_id":r["id"],"native_id":n["id"],"max_error_pp":mx,
                     "worst_time":d["reference_time"][errors.index(mx)],
                     "polarity_equal":{"+":"R","-":"B","":"U"}[r["polarity"]]==n["polarity"]})
    mx=max(x["max_error_pp"] for x in rows)
    return {"status":"PROJECTED_TOPOLOGY_MATCH_DIAGNOSTIC", "original_equation":eq[0],
            "matched":len(rows),"contracted":len(changes),"projection":changes,
            "max_error_pp":mx,"within_provisional_tolerance":mx<=TOL,
            "all_polarities_match":all(x["polarity_equal"] for x in rows),"loops":rows,
            "periods":periods_for(d,ref,native,next(iter(partitions)))}


def open_reports(path):
    if path.is_dir():
        return {name:json.loads((path/(name+".json")).read_bytes()) for name in ("inventoryWorkforce","marketGrowth")}
    receipt=json.loads((HERE/"evidence"/"45694445445"/"manifest.json").read_text())
    raw=path.read_bytes()
    require(len(raw)==receipt["zip_bytes"] and hashlib.sha256(raw).hexdigest()==receipt["zip_sha256"],"archive identity mismatch")
    with zipfile.ZipFile(path) as z:
        require(len(z.namelist())==len(set(z.namelist())) and set(z.namelist())==set(receipt["files"]),"archive members differ")
        for name,(size,digest) in receipt["files"].items():
            data=z.read(name)
            require(len(data)==size and hashlib.sha256(data).hexdigest()==digest,"archive member mismatch "+name)
        return {name:json.loads(z.read(name+".json")) for name in ("inventoryWorkforce","marketGrowth")}


def main():
    p=argparse.ArgumentParser()
    p.add_argument("reports",type=Path,help="verified original ZIP or current run report directory")
    p.add_argument("market_source",type=Path)
    a=p.parse_args()
    d=open_reports(a.reports)
    out={"admitted":False,"retrospective":True,
         "inventoryWorkforce":inventory(d["inventoryWorkforce"]),
         "marketGrowth":market(d["marketGrowth"],a.market_source.read_bytes())}
    print(json.dumps(out,indent=2,allow_nan=False))


if __name__=="__main__":
    main()
