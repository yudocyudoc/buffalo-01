"""A4: independent integration, sampling and delay controls; no admission."""
import hashlib
import json
import math
from pathlib import Path
import tempfile
from oracle import partials, require

DT=.25
STOP=4
TOL=1e-9


def z(x,y):
    return x*x*y


def rhs(t,state):
    x,y=state
    q=z(x,y)
    return (1+q/1000,1+t/2+q/2000)


def advance(fn,t,state,h,method):
    require(method in ("Euler","RK4"),"unknown method")
    def add(a,b,k):
        return tuple(x+k*y for x,y in zip(a,b))
    k1=fn(t,state)
    if method=="Euler":
        return add(state,k1,h)
    k2=fn(t+h/2,add(state,k1,h/2))
    k3=fn(t+h/2,add(state,k2,h/2))
    k4=fn(t+h,add(state,k3,h))
    return tuple(x+h*(a+2*b+2*c+d)/6 for x,a,b,c,d in zip(state,k1,k2,k3,k4))


def trajectory(fn,initial,method,dt=DT,stop=STOP):
    n=round(stop/dt)
    require(n*dt==stop,"nonintegral grid")
    states=[initial]
    for i in range(n):
        states.append(advance(fn,i*dt,states[-1],dt,method))
    return states


def clock_rows(method):
    states=trajectory(rhs,(2.,3.),method)
    return [{"time":i*DT,"x":x,"y":y,"z":z(x,y)} for i,(x,y) in enumerate(states)]


def scores(rows,i,lag):
    require(i>=lag>0,"unavailable interval")
    old,new=rows[i-lag],rows[i]
    return [l["score"] for l in partials(z,(old["x"],old["y"]),(new["x"],new["y"]),"first")["links"]]


def header(method,save,variables):
    return f'''<?xml version="1.0"?>
<xmile xmlns="http://docs.oasis-open.org/xmile/ns/XMILE/v1.0" xmlns:isee="http://iseesystems.com/XMILE" version="1.0">
<header><smile version="1.0" namespace="std"/><name>A4 clock</name><vendor>Buffalo research</vendor><product version="1.0">A4 synthetic control</product></header>
<sim_specs method="{method}" time_units="Day" isee:save_interval="{save}"><start>0</start><stop>{STOP}</stop><dt>{DT}</dt></sim_specs>
<model><variables>{variables}</variables></model></xmile>'''.encode()


def clock_xml(method,save):
    return header(method,save,'''<stock name="x"><eqn>2</eqn><inflow>f</inflow></stock>
<stock name="y"><eqn>3</eqn><inflow>g</inflow></stock>
<flow name="f"><eqn>1+z/1000</eqn></flow>
<flow name="g"><eqn>1+TIME/2+z/2000</eqn></flow>
<aux name="z"><eqn>x*x*y</eqn></aux>''')


def link_map(native):
    links={(l["from"],l["to"]):l["raw"] for l in native["links"]}
    require(len(links)==len(native["links"]),"duplicate native edge")
    return links


def compare_clock(native,method,save):
    rows=clock_rows(method)
    stride=round(save/DT)
    idx=list(range(0,len(rows),stride))
    expected_time=[rows[i]["time"] for i in idx]
    require(native["time"]==expected_time,"save grid mismatch")
    tr=native["trajectory"]
    errs={k:max(abs(v-rows[i][k]) for v,i in zip(tr[k],idx)) for k in ("x","y","z")}
    require(all(len(tr[k])==len(idx) for k in errs),"trajectory length mismatch")
    links=link_map(native)
    selected=[links.get((s,"z")) for s in ("x","y")]
    require(all(v is not None and len(v)==len(idx) for v in selected),"missing raw score")
    # Identical interior support, no time fitting or interpolation.
    records=[]
    for j,i in enumerate(idx[1:-1],1):
        actual=[s[j] for s in selected]
        require(all(v is not None and math.isfinite(v) for v in actual),"nonfinite raw score")
        records.append({"time":rows[i]["time"],"actual":actual,
                        "integration_interval":scores(rows,i,1),
                        "saved_interval":scores(rows,i,stride)})
    error={k:max(abs(a-b) for r in records for a,b in zip(r["actual"],r[k]))
           for k in ("integration_interval","saved_interval")}
    return {"trajectory_max_error":errs,"trajectory_matches":max(errs.values())<=TOL,
            "score_max_error":error,"records":records,"samples":2*len(records)}


def sampling_pair(full,coarse):
    a={r["time"]:r["actual"] for r in full["records"]}
    b={r["time"]:r["actual"] for r in coarse["records"]}
    require(b.keys()<=a.keys(),"sample support mismatch")
    return {"max_raw_error_at_shared_times":max(abs(x-y) for t in b for x,y in zip(a[t],b[t])),
            "shared_times":sorted(b)}


def delay_rhs(t,state):
    # DELAY3 material pipeline with total delay 3, each residence time 1.
    a,b,c=state
    u=2+t
    return (u-a,a-b,b-c)


def delay_rows(method):
    states=trajectory(delay_rhs,(2.,2.,2.),method)
    return [{"time":i*DT,"input_rate":2+i*DT,"a":a,"b":b,"c":c,"output_rate":c}
            for i,(a,b,c) in enumerate(states)]


def delay_xml(method,macro):
    base='<aux name="input_rate"><eqn>2+TIME</eqn></aux>'
    if macro:
        variables=base+'<aux name="output_rate"><eqn>DELAY3(input_rate,3,2)</eqn></aux>'
    else:
        # Explicit material flows, not signal-only smooth approximation.
        variables=base+'''<stock name="a"><eqn>2</eqn><inflow>f0</inflow><outflow>f1</outflow></stock>
<stock name="b"><eqn>2</eqn><inflow>f1</inflow><outflow>f2</outflow></stock>
<stock name="c"><eqn>2</eqn><inflow>f2</inflow><outflow>f3</outflow></stock>
<flow name="f0"><eqn>input_rate</eqn></flow><flow name="f1"><eqn>a</eqn></flow>
<flow name="f2"><eqn>b</eqn></flow><flow name="f3"><eqn>c</eqn></flow>
<aux name="output_rate"><eqn>f3</eqn></aux>'''
    return header(method,DT,variables)


def compare_delay(native,method,macro):
    rows=delay_rows(method)
    require(native["time"]==[r["time"] for r in rows],"delay time grid")
    fields=["input_rate","output_rate"]+([] if macro else ["a","b","c"])
    tr=native["trajectory"]
    require(all(len(tr[k])==len(rows) for k in fields),"delay series length")
    errors={k:max(abs(v-r[k]) for v,r in zip(tr[k],rows)) for k in fields}
    return {"trajectory_max_error":errors,"matches":max(errors.values())<=TOL}


def main():
    import importlib.metadata as md
    import simlin
    from native_probe import measure
    require(md.version("pysimlin")=="0.8.5","version drift")
    out={"admitted":False,"backend":md.version("pysimlin"),"dt":DT,"tolerance":TOL,
         "cases":{},"pairs":{}}
    for method in ("Euler","RK4"):
        for kind,setting in (("clock",DT),("clock",1.),("delay",False),("delay",True)):
            name=f"{method}_{kind}_{setting}"
            d={}
            out["cases"][name]=d
            try:
                raw=clock_xml(method,setting) if kind=="clock" else delay_xml(method,setting)
                d["source_sha256"]=hashlib.sha256(raw).hexdigest()
                with tempfile.TemporaryDirectory() as td:
                    p=Path(td)/"a4.xmile"
                    p.write_bytes(raw)
                    d["native"]=measure(simlin.load(p))
                d["comparison"]=(compare_clock(d["native"],method,setting) if kind=="clock"
                                 else compare_delay(d["native"],method,setting))
                d["status"]="OBSERVED"
            except Exception as e:
                d.update(status="EXECUTION_FAILURE",error=type(e).__name__+": "+str(e))
        a,b=(out["cases"][f"{method}_clock_{v}"] for v in (DT,1.))
        if a["status"]==b["status"]=="OBSERVED":
            out["pairs"][method+"_sampling"]=sampling_pair(a["comparison"],b["comparison"])
        a,b=(out["cases"][f"{method}_delay_{v}"] for v in (False,True))
        if a["status"]==b["status"]=="OBSERVED":
            x,y=(d["native"]["trajectory"]["output_rate"] for d in (a,b))
            out["pairs"][method+"_delay"]={"max_output_error":max(abs(v-w) for v,w in zip(x,y))}
    out["oracle"]={m:{"clock":clock_rows(m),"delay":delay_rows(m)} for m in ("Euler","RK4")}
    print(json.dumps(out,allow_nan=False,indent=2))
    if any(d["status"]!="OBSERVED" for d in out["cases"].values()):
        raise SystemExit(1)

if __name__=="__main__":
    main()
