"""Mai-Bab: structural vs observed activity vs reference normalization.

Astra review hypothesis. Original fixtures immutable. The graph with two
inactive edges removed is an explicitly retrospective diagnostic only.
"""
import hashlib
import json
import math
from pathlib import Path
import re
import tempfile
import xml.etree.ElementTree as ET
from cycle_audit import authored_graph, cycles, stock_partitions, reference_graph, signature, canon
from reference_revisit import full_grid_copy
from oracle import require

NS="{http://docs.oasis-open.org/xmile/ns/XMILE/v1.0}"
EDGES={("food_availability","deer_growth_fraction"),
       ("food_availability","food_consumption_per_deer")}
SCALE=100
SHORT_STOP=1812
DT=.125


def finite_series(values,n):
    return values is not None and len(values)==n and all(
        isinstance(v,(float,int)) and math.isfinite(v) for v in values)


def zero_series(values,n):
    return finite_series(values,n) and all(v==0 for v in values)


def lookup_bounds(raw):
    root=ET.fromstring(raw)
    result={}
    for v in root.findall(NS+"model/"+NS+"variables/"+NS+"aux"):
        name=canon(v.attrib["name"])
        if name not in {b for a,b in EDGES}:
            continue
        require(canon(v.findtext(NS+"eqn"))=="food_availability","unexpected lookup input")
        gf=v.find(NS+"gf")
        xp=gf.findtext(NS+"xpts")
        if xp:
            x=[float(s) for s in xp.split(",")]
            lo,hi=x[0],x[-1]
        else:
            scale=gf.find(NS+"xscale")
            lo,hi=float(scale.get("min")),float(scale.get("max"))
        result[name]={"min":lo,"max":hi}
    require(set(result)=={b for a,b in EDGES},"lookup inventory mismatch")
    return result


def observation(native,bounds):
    n=len(native["time"])
    tr=native["trajectory"]
    availability=tr["food_availability"]
    require(finite_series(availability,n),"missing food availability")
    links={(l["from"],l["to"]):l["raw"] for l in native["links"]}
    require(len(links)==len(native["links"]),"duplicate native edge")
    edges={}
    for a,b in sorted(EDGES):
        raw=links.get((a,b))
        vals=tr[b]
        require(finite_series(raw,n) and finite_series(vals,n),"missing lookup observation "+b)
        lo,hi=bounds[b]["min"],bounds[b]["max"]
        edges[b]={"all_raw_zero":zero_series(raw,n),"nonzero_samples":sum(v!=0 for v in raw),
                  "constant_output":min(vals)==max(vals),"output_range":[min(vals),max(vals)],
                  "interior_samples":sum(lo<x<hi for x in availability),
                  "above_upper_bound_samples":sum(x>hi for x in availability)}
    loops={}
    for l in native["loops"]:
        c=signature(l["cycle"])
        require(c not in loops and finite_series(l["relative"],n),"missing or duplicate cycle")
        loops[c]={"id":l["id"],"partition":l["partition"],
                  "all_relative_zero":zero_series(l["relative"],n),
                  "nonzero_samples":sum(v!=0 for v in l["relative"]),
                  "max_abs_relative":max(abs(v) for v in l["relative"]),
                  "contains_candidate_edges":[list(e) for e in sorted(set(zip(c,c[1:]+c[:1]))&EDGES)]}
    return {"samples":n,"availability_range":[min(availability),max(availability)],
            "edges":edges,"loops":[{"cycle":list(c),**v} for c,v in sorted(loops.items())],
            "partition_count":len({l["partition"] for l in native["loops"]})}


def pruned_graph(raw,obs,ref):
    nodes,edges,stocks=authored_graph(raw)
    require(EDGES<=edges,"candidate edges not authored")
    require(all(v["all_raw_zero"] and v["constant_output"] and
                v["above_upper_bound_samples"]==obs["samples"]
                for v in obs["edges"].values()),"candidate saturation not confirmed")
    all_cycles=cycles(nodes,edges)
    kept=cycles(nodes,edges-EDGES)
    parts=stock_partitions(nodes,edges-EDGES,stocks,kept)
    zero={tuple(l["cycle"]) for l in obs["loops"] if l["all_relative_zero"]}
    native={tuple(l["cycle"]) for l in obs["loops"]}
    require(native==all_cycles,"native/authored cycle inventory mismatch")
    def groups(mapping):
        g={}
        for c,p in mapping.items():
            g.setdefault(p,set()).add(c)
        return {frozenset(v) for v in g.values()}
    return {"structural_cycles":len(all_cycles),"pruned_cycles":len(kept),
            "removed_edges":[list(e) for e in sorted(EDGES)],
            "removed_cycles":[list(c) for c in sorted(all_cycles-kept)],
            "removed_exactly_zero_cycles":all_cycles-kept==zero,
            "reference_cycle_match":kept==set(ref),
            "reference_group_match":groups(parts)==groups(ref),
            "pruned_stock_partitions":sorted(set(parts.values()))}


def reference_group_diagnostic(native,grid,ref):
    # Explicitly retrospective, never replaces official denominator or admission.
    times=native["time"]
    index={t:i for i,t in enumerate(times)}
    require(len(index)==len(times) and all(t in index for t in grid),"grid mismatch")
    loops={signature(l["cycle"]):l["relative"] for l in native["loops"]}
    require(set(ref)<=set(loops),"reference cycle missing")
    groups={}
    for c,l in ref.items():
        groups.setdefault(l["group"],[]).append(c)
    out={}
    for group,members in groups.items():
        samples=[]
        for j,t in enumerate(grid):
            i=index[t]
            raw=[abs(loops[c][i]) for c in members]
            total=math.fsum(raw)
            if total==0:
                continue
            err=[abs(100*x/total-ref[c]["scores"][j]) for c,x in zip(members,raw)]
            samples.append({"time":t,"share_of_native_total":total,"max_error_pp":max(err)})
        require(samples,"empty group diagnostic")
        out[group]={"active_samples":len(samples),"max_error_pp":max(r["max_error_pp"] for r in samples),
                    "at_1811":next((r for r in samples if r["time"]==1811),None)}
    return out


def edit_once(raw,pattern,replacement):
    matches=list(re.finditer(pattern,raw))
    require(len(matches)==1,"unexpected byte edit cardinality")
    i,j=matches[0].span(1)
    old=raw[i:j]
    new=raw[:i]+replacement+raw[j:]
    require(new[:i]+old+new[i+len(replacement):]==raw,"nonreversible edit")
    return new,{"offset":i,"old":old.decode(),"new":replacement.decode(),
                "source_sha256":hashlib.sha256(raw).hexdigest(),
                "derived_sha256":hashlib.sha256(new).hexdigest()}


def short_copy(raw,perturbed):
    # Both arms share the short horizon and dense grid. Only the experimental
    # arm changes Normal Food Per Deer, from 1 to 100, fixed before native run.
    root=ET.fromstring(raw)
    short,receipt=edit_once(raw,rb'<sim_specs\b[^>]*>[\s\S]*?<stop>(2300)</stop>',str(SHORT_STOP).encode())
    root.find(NS+"sim_specs/"+NS+"stop").text=str(SHORT_STOP)
    receipts=[receipt]
    if perturbed:
        short,receipt=edit_once(short,rb'<aux name="Normal Food Per Deer">\s*<eqn>(1)</eqn>',str(SCALE).encode())
        receipts.append(receipt)
        variables=root.find(NS+"model/"+NS+"variables")
        target=[v for v in variables if v.attrib["name"]=="Normal Food Per Deer"]
        require(len(target)==1,"normal food parameter missing")
        target[0].find(NS+"eqn").text=str(SCALE)
    require(ET.tostring(root)==ET.tostring(ET.fromstring(short)),"unexpected XML drift")
    return short,receipts


def main():
    import importlib.metadata as md
    from benchmark import MANIFEST,blob,prepare_source_xml,load_native,reference_data
    from native_probe import measure
    require(md.version("pysimlin")=="0.8.5","backend drift")
    xb=Path("/reference/maibab.stmx").read_bytes()
    jb=Path("/reference/maibab.json").read_bytes()
    require([blob(jb),blob(xb)]==MANIFEST["fixtures"]["maibab"],"fixture drift")
    out={"admitted":False,"kind":"retrospective_activity_and_controlled_perturbation",
         "source_blobs":[blob(jb),blob(xb)],"cases":{}}
    raw=prepare_source_xml("maibab",xb,out)
    dense,receipt=full_grid_copy(raw,DT)
    out["full_grid_derivation"]=receipt
    bounds=lookup_bounds(raw)
    out["lookup_bounds"]=bounds
    ref=reference_graph(json.loads(jb))
    for name in ("original_full","short_control","short_perturbed"):
        d={}
        out["cases"][name]=d
        try:
            src=dense
            if name!="original_full":
                src,d["edits"]=short_copy(dense,name=="short_perturbed")
                require(authored_graph(src)[1:]==authored_graph(dense)[1:],"changed structural graph")
            with tempfile.TemporaryDirectory() as td:
                model=load_native(Path(td)/"maibab.xmile",src,d)
                n=measure(model)
            stop=2300 if name=="original_full" else SHORT_STOP
            require(n["time"]==[1810+i*DT for i in range(round((stop-1810)/DT)+1)],"grid mismatch")
            require(n["ltm_mode"]=="exhaustive","not exhaustive")
            d["observation"]=observation(n,bounds)
            d["native"]=n
            if name=="original_full":
                d["graph_diagnostic"]=pruned_graph(raw,d["observation"],ref)
                grid,reference,_,_=reference_data(json.loads(jb))
                d["reference_renormalization_diagnostic"]=reference_group_diagnostic(n,grid,reference)
            d["status"]="OBSERVED"
        except Exception as e:
            d.update(status="EXECUTION_FAILURE",error=type(e).__name__+": "+str(e))
    if all(d["status"]=="OBSERVED" for d in out["cases"].values()):
        original=out["cases"]["original_full"]["observation"]
        control=out["cases"]["short_control"]["observation"]
        variant=out["cases"]["short_perturbed"]["observation"]
        zero={tuple(l["cycle"]) for l in original["loops"] if l["all_relative_zero"]}
        a={tuple(l["cycle"]):l for l in control["loops"]}
        b={tuple(l["cycle"]):l for l in variant["loops"]}
        require(a.keys()==b.keys()=={tuple(l["cycle"]) for l in original["loops"]},"cycle identity drift")
        out["perturbation_summary"]={"scale":SCALE,"horizon":[1810,SHORT_STOP],
            "reactivated_original_zero_cycles":[list(c) for c in sorted(zero)
                if a[c]["all_relative_zero"] and b[c]["nonzero_samples"]>0],
            "original_zero_cycle_count":len(zero),
            "control_partitions":control["partition_count"],"perturbed_partitions":variant["partition_count"],
            "stella_comparison":"NOT_EXECUTED"}
    print(json.dumps(out,allow_nan=False,indent=2))
    if any(d["status"]!="OBSERVED" for d in out["cases"].values()):
        raise SystemExit(1)

if __name__=="__main__":
    main()
