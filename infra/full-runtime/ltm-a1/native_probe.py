"""Observe native links and trajectories; do not modify any baseline report."""
import hashlib
import importlib.metadata as md
import json
import math
from pathlib import Path
import tempfile
import simlin
from oracle import pulse_rows, bass, require
from benchmark import load_native, cycle

XMILE = """<?xml version="1.0"?>
<xmile xmlns="http://docs.oasis-open.org/xmile/ns/XMILE/v1.0" version="1.0">
<header><name>A1 pulse</name></header>
<sim_specs method="Euler" time_units="Day"><start>0</start><stop>5</stop><dt>1</dt></sim_specs>
<model><variables>
<stock name="x"><eqn>2</eqn><inflow>f</inflow></stock>
<stock name="y"><eqn>3</eqn><inflow>g</inflow></stock>
<flow name="f"><eqn>1+z/1000</eqn></flow>
<flow name="g"><eqn>1+STEP(3,2)</eqn></flow>
<aux name="z"><eqn>x*x*y</eqn></aux>
</variables></model></xmile>"""

def series(xs):
    return None if xs is None else [float(x) if math.isfinite(float(x)) else None for x in xs]


def measure(model):
    with model.simulate(enable_ltm=True) as sim:
        sim.run_to_end()
        run=sim.get_run()
        frame=run.results
        t=series(frame.index)
        links=[{"from":l.from_var,"to":l.to_var,"polarity":str(l.polarity),
                "raw":series(l.score)} for l in sim.get_links()]
        loops=[{"id":l.id,"cycle":list(cycle(l.variables)),"partition":l.partition,
                "relative":series(l.behavior_time_series)} for l in run.loops]
        require(all(l["raw"] is None or len(l["raw"])==len(t) for l in links),"raw link grid mismatch")
        return {"time":t,"trajectory":{str(k):series(frame[k]) for k in frame.columns},
                "links":links,"loops":loops,"ltm_mode":run.ltm_mode,
                "imported_specs":json.loads(model.project.serialize_json())["simSpecs"]}


def compare(native,rows,target,sources):
    actual={ (l["from"],l["to"]):l["raw"] for l in native["links"]}
    require(len(actual)==len(native["links"]),"duplicate native links")
    require(native["time"]==[r["time"] for r in rows],"different time grid")
    selected=[actual.get((source,target)) for source in sources]
    if any(a is None for a in selected):
        return {"status":"RAW_LINK_NOT_AVAILABLE","requested":[[s,target] for s in sources]}
    result={}
    for key in ("first_end","last_end","first_start","last_start"):
        # Same interior support for all hypotheses. Exclude both boundaries explicitly.
        errors=[]
        for i,r in enumerate(rows[1:-1],1):
            for j,l in enumerate(r["hypotheses"][key]["links"]):
                v=selected[j][i]
                if v is None:
                    return {"status":"NONFINITE_NATIVE_RAW","time":r["time"]}
                errors.append(abs(v-l["score"]))
        result[key]={"max_abs_error":max(errors),"samples":len(errors),
                     "rmse":math.sqrt(sum(v*v for v in errors)/len(errors))}
    return {"status":"OBSERVED","errors":result}


def main():
    require(md.version("pysimlin")=="0.8.5","backend drift")
    result={"admitted":False,"backend":md.version("pysimlin"),
            "wheel_source_commit":"UNVERIFIED","cases":{}}
    for case in ("pulse","bass"):
        out={}
        result["cases"][case]=out
        try:
            with tempfile.TemporaryDirectory() as td:
                p=Path(td)/(case+".xmile")
                if case=="pulse":
                    raw=XMILE.encode()
                    p.write_bytes(raw)
                    model=simlin.load(p)
                    rows=pulse_rows()
                    target,sources="z",["x","y"]
                else:
                    raw=Path("/reference/bassDiffusion.stmx").read_bytes()
                    rows=bass(Path("/reference"))["rows"]
                    model=load_native(p,raw,out)
                    target,sources="potentials_contacts_with_adopters",["adopter_contacts","probability_of_contact_with_potentials"]
                out["source_sha256"]=hashlib.sha256(raw).hexdigest()
                out["native"]=measure(model)
                out["comparison"]=compare(out["native"],rows,target,sources)
                if case=="pulse":
                    tr=out["native"]["trajectory"]
                    out["trajectory_max_abs_error"]={k:max(abs(v-r[k]) for v,r in zip(tr[k],rows))
                                                     for k in ("x","y","z")}
                out["status"]="OBSERVED" if out["comparison"]["status"]=="OBSERVED" else "INCOMPLETE"
        except Exception as e:
            out.update(status="EXECUTION_FAILURE",error=type(e).__name__+": "+str(e))
    print(json.dumps(result,allow_nan=False,indent=2))
    # Missing observations are not accepted as completed controls.
    if any(c["status"]!="OBSERVED" for c in result["cases"].values()):
        raise SystemExit(1)

if __name__=="__main__":
    main()
