"""A5: system change, Schoenberg/Eberlein/Davidsen (2024), eqs 4-6.

Independent postprocessor of instantaneous signed stock net flows on a complete
uniform integration grid. No assertion that Simlin exposes this metric.
"""
import hashlib
import json
import math
from pathlib import Path
import tempfile
from clock_audit import clock_xml, clock_rows, header, DT, STOP
from oracle import require

TOL=1e-9


def system_change(times,net):
    require(len(times)>=2 and all(math.isfinite(t) for t in times),"invalid time grid")
    dt=times[1]-times[0]
    require(dt>0 and all(math.isclose(b-a,dt,rel_tol=1e-12,abs_tol=1e-12)
                         for a,b in zip(times,times[1:])),"nonuniform time grid")
    require(bool(net),"no stock net flows")
    require(all(len(v)==len(times) and all(math.isfinite(x) for x in v) for v in net.values()),
            "missing or nonfinite net flow")
    absolute={k:[abs(x) for x in v] for k,v in net.items()}
    accumulated={k:math.fsum(v) for k,v in absolute.items()}
    # Explicit extension for zero denominators: a stock with no movement
    # contributes zero. If all stocks are static, the whole series is zero.
    shares={k:[x/accumulated[k] if accumulated[k] else 0. for x in v]
            for k,v in absolute.items()}
    raw=[math.fsum(v[i] for v in shares.values()) for i in range(len(times))]
    peak=max(raw)
    return {"time":list(times),"net_flows":net,"accumulated":accumulated,
            "zero_change_stocks":[k for k,a in accumulated.items() if a==0],
            "stock_shares":shares,"raw":raw,"peak":peak,
            "normalized":[v/peak if peak else 0. for v in raw]}


def example(scale=1):
    # Two independently moving stocks with opposite signed net flow;
    # an equilibrium stock has equal inflow and outflow, not zero throughput.
    times=[0,1,2,3]
    return system_change(times,{"x":[0,2,0,2],"y":[0,0,-3*scale,0],"static":[0]*4})


def material_xml(scale):
    require(scale in (1,1000),"unsupported control scale")
    variables=f'''<stock name="x"><eqn>10</eqn><inflow>xi</inflow><outflow>xo</outflow></stock>
<stock name="y"><eqn>{10*scale}</eqn><inflow>yi</inflow><outflow>yo</outflow></stock>
<stock name="quiet"><eqn>10</eqn><inflow>qi</inflow><outflow>qo</outflow></stock>
<flow name="xi"><eqn>2+TIME</eqn></flow><flow name="xo"><eqn>2</eqn></flow>
<flow name="yi"><eqn>{scale}*2</eqn></flow><flow name="yo"><eqn>{scale}*(2+TIME*TIME)</eqn></flow>
<flow name="qi"><eqn>5</eqn></flow><flow name="qo"><eqn>5</eqn></flow>'''
    return header("Euler",DT,variables)


def native_net(native,flows):
    times=native["time"]
    tr=native["trajectory"]
    net={}
    for stock, signed in flows.items():
        require(stock in tr and len(tr[stock])==len(times),"missing stock")
        require(all(f in tr and len(tr[f])==len(times) for f,_ in signed),"missing flow")
        net[stock]=[math.fsum(sign*tr[f][i] for f,sign in signed) for i in range(len(times))]
    return system_change(times,net)


def compare(actual,expected):
    require(actual["time"]==expected["time"],"grid mismatch")
    require(actual["net_flows"].keys()==expected["net_flows"].keys(),"stock set mismatch")
    ne={k:max(abs(a-b) for a,b in zip(v,expected["net_flows"][k]))
        for k,v in actual["net_flows"].items()}
    # Net flow units differ across stocks: retain each absolute error separately.
    error=max(abs(a-b) for a,b in zip(actual["normalized"],expected["normalized"]))
    return {"net_flow_max_abs_error":ne,"normalized_max_abs_error":error,
            "matches_metric":error<=TOL,"zero_change_stocks_match":
                set(actual["zero_change_stocks"])==set(expected["zero_change_stocks"])}


def main():
    import importlib.metadata as md
    import simlin
    from native_probe import measure
    require(md.version("pysimlin")=="0.8.5","wheel drift")
    times=[i*DT for i in range(round(STOP/DT)+1)]
    out={"admitted":False,"backend":md.version("pysimlin"),
         "metric_implementation":"independent_postprocessor","tolerance":TOL,
         "cases":{},"pairs":{}}
    for name in ("material_1","material_1000","clock_Euler","clock_RK4"):
        d={}
        out["cases"][name]=d
        try:
            if name.startswith("material"):
                scale=int(name.split("_")[1])
                raw=material_xml(scale)
                flows={"x":[("xi",1),("xo",-1)],"y":[("yi",1),("yo",-1)],
                       "quiet":[("qi",1),("qo",-1)]}
                expected=system_change(times,{"x":times,"y":[-scale*t*t for t in times],
                                              "quiet":[0.]*len(times)})
            else:
                method=name.split("_")[1]
                raw=clock_xml(method,DT)
                flows={"x":[("f",1)],"y":[("g",1)]}
                rows=clock_rows(method)
                expected=system_change(times,{"x":[1+r["z"]/1000 for r in rows],
                                              "y":[1+r["time"]/2+r["z"]/2000 for r in rows]})
            d["source_sha256"]=hashlib.sha256(raw).hexdigest()
            with tempfile.TemporaryDirectory() as td:
                p=Path(td)/"a5.xmile"
                p.write_bytes(raw)
                d["native"]=measure(simlin.load(p))
            require(d["native"]["time"]==times,"incomplete integration grid")
            d["metric"]=native_net(d["native"],flows)
            d["expected"]=expected
            d["comparison"]=compare(d["metric"],expected)
            # Report adjacent state differences as an alternative diagnostic only.
            # No substitution for instantaneous signed net flows in eqs 4-6.
            tr=d["native"]["trajectory"]
            d["net_vs_forward_state_difference_max_error"]={
                s:max(abs(d["metric"]["net_flows"][s][i]-(tr[s][i+1]-tr[s][i])/DT)
                      for i in range(len(times)-1)) for s in flows}
            d["status"]="OBSERVED"
        except Exception as e:
            d.update(status="EXECUTION_FAILURE",error=type(e).__name__+": "+str(e))
    a,b=(out["cases"][f"material_{s}"] for s in (1,1000))
    if a["status"]==b["status"]=="OBSERVED":
        error=max(abs(x-y) for x,y in zip(a["metric"]["normalized"],b["metric"]["normalized"]))
        out["pairs"]["unit_rescaling"]={"max_normalized_error":error,"invariant":error<=TOL}
    print(json.dumps(out,allow_nan=False,indent=2))
    if any(d["status"]!="OBSERVED" for d in out["cases"].values()):
        raise SystemExit(1)

if __name__=="__main__":
    main()
