"""A2: independent flow-representation oracle and native observations.

Two synthetic Euler systems with identical material equations. This is a
local 2023 correction test, not a universal representation equivalence claim.
"""
import hashlib
import json
import math
from pathlib import Path
import tempfile

TOL = 1e-10  # predeclared for exact small scalar Euler example, not the six-case benchmark
TIMES = list(range(6))
# Both i and o depend on stock: both edges belong to actual feedback cycles.
DIRECT = {"R": ("s", "inflow_rate"), "B": ("s", "outflow_rate")}
NET = {"R": ("s", "inflow_rate", "net_rate"),
       "B": ("s", "outflow_rate", "net_rate")}


def require(ok, message):
    if not ok:
        raise ValueError(message)


def xml(net):
    stock = ("<inflow>net_rate</inflow>" if net else
             "<inflow>inflow_rate</inflow><outflow>outflow_rate</outflow>")
    tag = "aux" if net else "flow"
    rates = "".join(f'<{tag} name="{name}"><eqn>{eq}</eqn></{tag}>' for name, eq in
                    (("inflow_rate","5+5*(s-100)"),("outflow_rate","4+(s-100)")))
    if net:
        rates += '<flow name="net_rate"><eqn>inflow_rate-outflow_rate</eqn></flow>'
    return ('''<?xml version="1.0"?>
<xmile xmlns="http://docs.oasis-open.org/xmile/ns/XMILE/v1.0" version="1.0">
<header><smile version="1.0" namespace="std"/><name>A2 flow control</name><vendor>Buffalo research</vendor><product version="1.0">A2 synthetic control</product></header>
<sim_specs method="Euler" time_units="Day"><start>0</start><stop>5</stop><dt>1</dt></sim_specs>
<model><variables><stock name="s"><eqn>100</eqn>''' + stock +
            '</stock>'+rates+'</variables></model></xmile>')


def oracle():
    s=100
    rows=[]
    for t in TIMES:
        i=5+5*(s-100)
        o=4+s-100
        rows.append({"time":t,"s":s,"inflow_rate":i,"outflow_rate":o,"net_rate":i-o})
        s+=i-o
    # Corrected formula: changes in signed flows / change in net flow.
    for prev, row in zip(rows,rows[1:]):
        dn=row["net_rate"]-prev["net_rate"]
        di=row["inflow_rate"]-prev["inflow_rate"]
        do=row["outflow_rate"]-prev["outflow_rate"]
        require(dn and di and do,"degenerate synthetic interval")
        raw=[abs(di/dn),-abs(do/dn)]
        row["interval"]=[prev["time"],row["time"]]
        row["delta_net"]=dn
        row["delta_in"]=di
        row["delta_out"]=do
        row["raw"]=raw
        row["relative"]=[v/sum(abs(x) for x in raw) for v in raw]
        row["old_formula_diagnostic"]=[row["inflow_rate"]/row["net_rate"],
                                       -row["outflow_rate"]/row["net_rate"]]
    return rows


def sig(nodes):
    nodes=tuple(nodes)
    return min(nodes[k:]+nodes[:k] for k in range(len(nodes)))


def adjudicate(native, net):
    rows=oracle()
    require(native["time"]==TIMES,"time grid differs")
    require(native["ltm_mode"]=="exhaustive","not exhaustive")
    # Only exact expected directed cycles, no denominator contraction.
    expected=NET if net else DIRECT
    actual={sig(l["cycle"]):l for l in native["loops"]}
    require(len(actual)==len(native["loops"]) and set(actual)=={sig(v) for v in expected.values()},
            "unexpected cycle membership")
    partitions={l["partition"] for l in actual.values()}
    require(len(partitions)==1 and None not in partitions,"unexpected loop partition")
    links={(l["from"],l["to"]):l["raw"] for l in native["links"]}
    require(len(links)==len(native["links"]),"duplicate links")
    wanted={("s","inflow_rate"):1.,("s","outflow_rate"):1.}
    if net:
        wanted.update({("inflow_rate","net_rate"):1.25,("outflow_rate","net_rate"):-.25,
                       ("net_rate","s"):1.})
    else:
        wanted.update({("inflow_rate","s"):1.25,("outflow_rate","s"):-.25})
    for edge in wanted:
        require(edge in links and links[edge] is not None and len(links[edge])==len(TIMES),
                "missing raw link "+str(edge))
    fields=["s","inflow_rate","outflow_rate"]+(["net_rate"] if net else [])
    trajectory_error={k:max(abs(v-r[k]) for v,r in zip(native["trajectory"][k],rows))
                      for k in fields}
    require(all(len(native["trajectory"][k])==len(TIMES) for k in fields),"trajectory size")
    # Compare all interior samples, excluding the initialization and final slots.
    # Preserve those slots in the full native report for independent inspection.
    observations=[]
    for t in TIMES[1:-1]:
        raw={}
        for edge,value in wanted.items():
            v=links[edge][t]
            require(v is not None and math.isfinite(v),"nonfinite raw link")
            raw[" -> ".join(edge)]={"native":v,"expected":value,"abs_error":abs(v-value)}
        loops={}
        for j,(name,cycle) in enumerate(expected.items()):
            product=math.prod(links[(a,b)][t] for a,b in zip(cycle,cycle[1:]+cycle[:1]))
            observed=actual[sig(cycle)]["relative"][t]
            require(observed is not None and math.isfinite(observed),"missing relative loop score")
            loops[name]={"raw_product":product,"raw_expected":rows[t]["raw"][j],
                         "relative_native":observed,"relative_expected":rows[t]["relative"][j]}
        observations.append({"time":t,"links":raw,"loops":loops})
    errors=[v["abs_error"] for r in observations for v in r["links"].values()]
    errors += [abs(v["raw_product"]-v["raw_expected"]) for r in observations for v in r["loops"].values()]
    errors += [abs(v["relative_native"]-v["relative_expected"]) for r in observations for v in r["loops"].values()]
    mx=max(errors)
    return {"trajectory_error":trajectory_error,"max_abs_score_error":mx,
            "observations":observations,"matches_oracle":max([mx,*trajectory_error.values()])<=TOL}


def pair(direct, net):
    err=max(abs(a["loops"][k][field]-b["loops"][k][field])
            for a,b in zip(direct["observations"],net["observations"])
            for k in ("R","B") for field in ("raw_product","relative_native"))
    return {"max_abs_projected_loop_error":err,
            "invariant_on_observed_support":err<=TOL,
            "both_match_corrected_oracle":direct["matches_oracle"] and net["matches_oracle"]}


def main():
    import importlib.metadata as md
    import simlin
    from native_probe import measure
    require(md.version("pysimlin")=="0.8.5","wheel version drift")
    result={"admitted":False,"backend":md.version("pysimlin"),"tolerance":TOL,
            "oracle":oracle(),"cases":{}}
    for name,net in (("direct",False),("net",True)):
        d={}
        result["cases"][name]=d
        try:
            with tempfile.TemporaryDirectory() as td:
                p=Path(td)/(name+".xmile")
                raw=xml(net).encode()
                p.write_bytes(raw)
                d["source_sha256"]=hashlib.sha256(raw).hexdigest()
                d["native"]=measure(simlin.load(p))
                d["comparison"]=adjudicate(d["native"],net)
                d["status"]="OBSERVED"
        except Exception as e:
            d.update(status="EXECUTION_FAILURE",error=type(e).__name__+": "+str(e))
    complete=all(d["status"]=="OBSERVED" for d in result["cases"].values())
    if complete:
        result["pair"]=pair(*(result["cases"][k]["comparison"] for k in ("direct","net")))
    print(json.dumps(result,allow_nan=False,indent=2))
    # A measured mismatch is scientific evidence, not a transport failure.
    # Missing measurements or mismatched topology are incomplete observations.
    if not complete:
        raise SystemExit(1)

if __name__=="__main__":
    main()
