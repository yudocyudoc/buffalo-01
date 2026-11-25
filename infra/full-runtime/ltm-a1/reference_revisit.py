"""Post-A1–A5 diagnostic: original vs full integration grid, not admission.

The original benchmark and fixtures are immutable. Clock hypotheses are reported
separately on common interior support, never used to shift the official verdict.
"""
import hashlib
import json
import math
from pathlib import Path
import re
import tempfile
import xml.etree.ElementTree as ET
from oracle import require, partials, relative
from clock_audit import trajectory

NS="{http://docs.oasis-open.org/xmile/ns/XMILE/v1.0}"
SAVE="{http://iseesystems.com/XMILE}save_interval"
MARKET_NODE="$⁚current_capacity⁚0⁚delay3"
MARKET_EQUATION="DELAY3(desired_capacity,Capacity_Acquisition_Delay,  Initial_Capacity)"


def full_grid_copy(raw,dt):
    """Change only an existing save interval, with reversible byte receipt."""
    root=ET.fromstring(raw)
    spec=root.find(NS+"sim_specs")
    require(spec is not None,"missing sim_specs")
    old=spec.get(SAVE)
    if old is None or float(old)==dt:
        return raw,{"kind":"unchanged","save_interval":old}
    matches=list(re.finditer(rb'<sim_specs\b[^>]*>',raw))
    require(len(matches)==1,"ambiguous sim_specs")
    m=matches[0]
    attr=list(re.finditer(rb'isee:save_interval="([^"]+)"',m.group()))
    require(len(attr)==1 and float(attr[0][1])==float(old),"unexpected save attribute")
    i,j=(m.start()+v for v in attr[0].span(1))
    replacement=format(dt,".17g").encode()
    derived=raw[:i]+replacement+raw[j:]
    require(derived[:i]+raw[i:j]+derived[i+len(replacement):]==raw,"not reversible")
    spec.set(SAVE,replacement.decode())
    require(ET.tostring(root)==ET.tostring(ET.fromstring(derived)),"non-save XML drift")
    return derived,{"kind":"save-interval-only","offset":i,"old":old,
                    "new":replacement.decode(),"source_sha256":hashlib.sha256(raw).hexdigest(),
                    "derived_sha256":hashlib.sha256(derived).hexdigest()}


def sig(nodes):
    n=tuple(nodes)
    require(n and len(set(n))==len(n),"invalid cycle")
    return min(n[i:]+n[:i] for i in range(len(n)))


def index_loops(native,market=False):
    out={}
    for l in native["loops"]:
        n=l["cycle"]
        if market and MARKET_NODE in n:
            i=n.index(MARKET_NODE)
            require(n.count(MARKET_NODE)==1 and n[i-1]=="desired_capacity" and
                    n[(i+1)%len(n)]=="current_capacity","unexpected market delay path")
            n=[x for x in n if x!=MARKET_NODE]
        key=sig(n)
        require(key not in out,"duplicate projected cycle")
        out[key]=l
    return out


def positions(grid,requested):
    idx={t:i for i,t in enumerate(grid)}
    require(len(idx)==len(grid) and all(t in idx for t in requested),"exact grid mismatch")
    return [idx[t] for t in requested]


def maxerr(a,b):
    require(len(a)==len(b) and bool(a),"series shape mismatch")
    require(all(v is not None and math.isfinite(v) for v in [*a,*b]),"nonfinite score")
    return max(abs(x-y) for x,y in zip(a,b))


def partition_sets(loops,key):
    p={}
    for cycle,l in loops.items():
        require(l[key] is not None,"missing partition")
        p.setdefault(l[key],set()).add(cycle)
    return {frozenset(v) for v in p.values()}


def pair(original,dense):
    idx=positions(dense["time"],original["time"])
    a,b=index_loops(original),index_loops(dense)
    require(a.keys()==b.keys(),"save interval changed cycle topology")
    require(partition_sets(a,"partition")==partition_sets(b,"partition"),"save interval changed partitions")
    require(original["trajectory"].keys()==dense["trajectory"].keys(),"trajectory fields changed")
    ts={k:maxerr(v,[dense["trajectory"][k][i] for i in idx])
        for k,v in original["trajectory"].items()}
    ls={str(c):maxerr(l["relative"],[b[c]["relative"][i] for i in idx]) for c,l in a.items()}
    la={(l["from"],l["to"]):l["raw"] for l in original["links"]}
    lb={(l["from"],l["to"]):l["raw"] for l in dense["links"]}
    require(la.keys()==lb.keys(),"save interval changed link topology")
    missing=[]
    raw={}
    for e,x in la.items():
        y=lb[e]
        if x is None and y is None:
            missing.append(list(e))
        elif x is None or y is None:
            raise ValueError("save interval changed raw score coverage")
        else:
            # Nonfinite or absent samples are retained as coverage, not imputed.
            require(all((v is None)==(y[i] is None) for v,i in zip(x,idx)),"sample coverage changed")
            comparable=[(v,y[i]) for v,i in zip(x,idx) if v is not None]
            if comparable:
                raw[str(e)]=max(abs(v-w) for v,w in comparable)
    return {"shared_samples":len(idx),"trajectory_max_abs_error":max(ts.values()),
            "relative_max_abs_error":max(ls.values()),"raw_max_abs_error":max(raw.values()) if raw else None,
            "raw_unavailable_edges":missing,"per_variable_error":ts,"per_loop_error":ls,
            "per_link_error":raw}


def reference_clock(dense,grid,ref,market=False):
    got=index_loops(dense,market)
    if got.keys()!=ref.keys() or partition_sets(got,"partition")!=partition_sets(ref,"group"):
        return {"status":"NOT_COMPARABLE_TOPOLOGY_OR_DENOMINATOR",
                "native_count":len(got),"reference_count":len(ref)}
    idx=positions(dense["time"],grid)
    # Same support for all three clocks, excluding endpoint candidates.
    interior=[(j,i) for j,i in enumerate(idx) if 0<i<len(dense["time"])-1]
    require(interior,"no common interior support")
    report={}
    for offset in (-1,0,1):
        errors=[]
        details=[]
        for c,r in ref.items():
            x=got[c]["relative"]
            e=[abs(100*abs(x[i+offset])-r["scores"][j]) for j,i in interior]
            errors.extend(e)
            details.append({"id":r["id"],"group":r["group"],"max_pp":max(e)})
        report[str(offset)]={"max_pp":max(errors),"rmse_pp":math.sqrt(sum(e*e for e in errors)/len(errors)),
                             "samples":len(errors),"loops":details}
    return {"status":"DIAGNOSTIC_ONLY","offset_units":"one integration step",
            "common_reference_times":[grid[j] for j,i in interior],"hypotheses":report}


# Independent predator-prey RK4 based on the exact blob-pinned authored equations.
MORTALITY=(.94,.66,.4,.35,.3,.25,.2,.15,.1,.07,.05)


def lookup(x,values,step):
    if x<=0:return values[0]
    i=math.floor(x/step)
    if i>=len(values)-1:return values[-1]
    w=x/step-i
    return values[i]+w*(values[i+1]-values[i])


def predator_values(h,l):
    density=h/1000
    kills=lookup(density,tuple(range(0,501,50)),50)
    mortality=lookup(density,MORTALITY,10)
    return {"hares":h,"lynx":l,"hare_density":density,"hares_killed_per_lynx":kills,
            "lynx_death_fraction":mortality,"hare_births":max(0,1.25*h),
            "hare_deaths":max(0,l*kills),"lynx_births":max(0,.25*l),
            "lynx_deaths":max(0,l*mortality)}


def predator_oracle():
    def rhs(t,state):
        v=predator_values(*state)
        return v["hare_births"]-v["hare_deaths"],v["lynx_births"]-v["lynx_deaths"]
    return [predator_values(*s) for s in trajectory(rhs,(50000.,850.),"RK4",dt=1/32,stop=100)]


def predator_compare(dense):
    rows=predator_oracle()
    require(dense["time"]==[i/32 for i in range(len(rows))],"predator grid mismatch")
    errors={k:maxerr([v[k] for v in rows],dense["trajectory"][k]) for k in rows[0]}
    return {"max_abs_error":errors,"relative_stock_error":{
        k:errors[k]/max(abs(v[k]) for v in rows) for k in ("hares","lynx")},
        "lookup_assumption":"piecewise linear with endpoint clamping",
        "scope":"trajectory, not independent reference loop scores"}


def main():
    import importlib.metadata as md
    from benchmark import MANIFEST,blob,prepare_source_xml,load_native,reference_data
    from native_probe import measure
    require(md.version("pysimlin")=="0.8.5","backend drift")
    out={"admitted":False,"kind":"post_audit_reference_clock_diagnostics","cases":{}}
    for name,(jsha,xsha) in MANIFEST["fixtures"].items():
        d={}
        out["cases"][name]=d
        try:
            jb=Path("/reference",name+".json").read_bytes()
            xb=Path("/reference",name+".stmx").read_bytes()
            require((blob(jb),blob(xb))==(jsha,xsha),"source drift")
            raw=prepare_source_xml(name,xb,d)
            dt=d["source_specs"]["dt"]
            full,receipt=full_grid_copy(raw,dt)
            d["full_grid_derivation"]=receipt
            with tempfile.TemporaryDirectory() as td:
                for label,source in (("original",raw),("dense",full)):
                    imp={}
                    model=load_native(Path(td)/(label+".xmile"),source,imp)
                    d[label]=measure(model)
                    d[label]["import"]=imp
            start,stop=(d["source_specs"][k] for k in ("start","stop"))
            n=round((stop-start)/dt)
            require(d["dense"]["time"]==[start+i*dt for i in range(n+1)],"incomplete full integration grid")
            d["sampling_pair"]=pair(d["original"],d["dense"])
            grid,ref,groups,periods=reference_data(json.loads(jb))
            market=name=="marketGrowth"
            if market:
                root=ET.fromstring(raw)
                eq=[v.findtext(NS+"eqn") for v in root.findall(NS+"model/"+NS+"variables/"+NS+"aux")
                    if v.attrib["name"]=="current capacity"]
                require(eq==[MARKET_EQUATION],"unexpected delay equation")
            d["reference_clock"]=reference_clock(d["dense"],grid,ref,market)
            d["reference_clock"]["market_projection_diagnostic_only"]=market
            if name=="predatorPrey":
                d["independent_predator_trajectory"]=predator_compare(d["dense"])
            d["status"]="OBSERVED"
        except Exception as e:
            d.update(status="EXECUTION_FAILURE",error=type(e).__name__+": "+str(e))
    print(json.dumps(out,allow_nan=False,indent=2))
    if any(d["status"]!="OBSERVED" for d in out["cases"].values()):
        raise SystemExit(1)

if __name__=="__main__":
    main()
