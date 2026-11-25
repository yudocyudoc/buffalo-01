"""Independent scalar LTM controls. No Simlin imports, no production admission."""
import hashlib
import json
import math
from pathlib import Path
import sys

BASS_JSON = "c87fc9d8369cdb0abb97bb7ba1e2a88c32df931e"
BASS_XML = "f760d13c9a17a2deaf2fa6abaeaad38d3ef15fd2"
KEY = "Percent of Model Behavior Explained by Loop"


def blob(raw):
    return hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()


def require(ok, message):
    if not ok:
        raise ValueError(message)


def partials(fn, old, new, mode):
    require(mode in ("first", "last"), "unknown attribution")
    require(len(old) == len(new) and len(old) > 0, "invalid inputs")
    z0, z1 = fn(*old), fn(*new)
    dz = z1 - z0
    links = []
    for i, (a, b) in enumerate(zip(old, new)):
        values = list(old if mode == "first" else new)
        values[i] = b if mode == "first" else a
        partial = fn(*values) - z0 if mode == "first" else z1 - fn(*values)
        dx = b - a
        score = (abs(partial / dz) * (1 if partial / dx > 0 else -1)
                 if dx and dz and partial else 0.0)
        links.append({"dx": dx, "partial": partial, "score": score})
    return {"old": list(old), "new": list(new), "z0": z0, "z1": z1,
            "dz": dz, "mode": mode, "links": links,
            "unallocated_change": dz - sum(l["partial"] for l in links),
            "zero_denominator": dz == 0}


def relative(raw):
    denom = sum(abs(v) for v in raw)
    return [v / denom if denom else 0.0 for v in raw]


def interval(fn, states, i, mode, anchor):
    j = i if anchor == "end" else i + 1
    require(anchor in ("start", "end") and 0 < j < len(states), "interval unavailable")
    return {"interval": [j-1, j], **partials(fn, states[j-1], states[j], mode)}


def flow_tables():
    # Schoenberg et al. 2023, Tables 1-3. dt=1 exactly.
    old, new = (5, 4), (10, 5)
    net = lambda i, o: i-o
    aggregated = partials(net, old, new, "first")
    stocks = [100, 101, 106]
    curvature = stocks[2] - 2*stocks[1] + stocks[0]
    direct = [abs((new[0]-old[0])/curvature), -abs((new[1]-old[1])/curvature)]
    return {"stocks": stocks, "table1_original": [2., -1.],
            "table2_net": aggregated, "net_to_stock": 1.,
            "table3_direct": direct, "stock_second_difference": curvature}


def pulse_states(coupled=False):
    # Fixed synthetic stock feedback with an independent forcing pulse.
    # x'=1+z/1000, y'=1+3*STEP(1,2); z=x*x*y; dt=1.
    x, y = 2., 3.
    out = [(x, y)]
    for t in range(5):
        z = x*x*y
        x, y = x + 1 + z/1000, y + 1 + (3 if t >= 2 else 0) + (z/2000 if coupled else 0)
        out.append((x, y))
    return out


def pulse_rows(coupled=False):
    states = pulse_states(coupled)
    f = lambda x,y: x*x*y
    return [{"time": i, "x": x, "y": y, "z": f(x,y),
             "hypotheses": {mode+"_"+anchor: interval(f, states, i, mode, anchor)
                            for mode in ("first","last") for anchor in ("start","end")
                            if 0 < (i if anchor=="end" else i+1) < len(states)}}
            for i,(x,y) in enumerate(states)]


def bass(ref_dir):
    jb = (ref_dir/"bassDiffusion.json").read_bytes()
    xb = (ref_dir/"bassDiffusion.stmx").read_bytes()
    require(blob(jb)==BASS_JSON and blob(xb)==BASS_XML, "Bass source drift")
    f = json.loads(jb)["feedback"]
    loops = {l["identifier"]: l for l in f["feedbackLoops"]}
    require(set(loops)=={"R1","B1"}, "unexpected Bass loops")
    refs = {k:l[KEY] for k,l in loops.items()}
    require(all([p["time"] for p in series]==[i/16 for i in range(241)]
                for series in refs.values()), "unexpected Bass grid")
    M = 1000000
    h = 1/16
    a = [1.]
    for i in range(241):  # extra step for explicitly forward endpoint hypothesis
        a.append(a[-1]+h*1.5*a[-1]*(1-a[-1]/M))
    states = [(x, M-x) for x in a]
    fn = lambda A,P: A*P
    rows = []
    for i in range(241):
        row = {"time": i*h, "A": a[i], "P": M-a[i],
               "reference_percent": [refs["R1"][i]["value"], refs["B1"][i]["value"]],
               "hypotheses": {}}
        for mode in ("first","last"):
            for anchor in ("start","end"):
                if i==0 and anchor=="end":
                    continue
                j = i if anchor=="end" else i+1
                d = partials(fn, states[j-1], states[j], mode)
                raw = [d["links"][0]["score"], -d["links"][1]["score"]]
                row["hypotheses"][mode+"_"+anchor] = {
                    "interval": [(j-1)*h,j*h], **d, "raw_loop_scores":raw,
                    "relative_loop_scores":relative(raw)}
        rows.append(row)
    errors = {}
    for key in ("first_end","last_end","first_start","last_start"):
        err = [abs(abs(v)*100-r) for row in rows[1:] for v,r in
               zip(row["hypotheses"][key]["relative_loop_scores"], row["reference_percent"])]
        errors[key] = {"max_pp":max(err), "rmse_pp":math.sqrt(sum(e*e for e in err)/len(err)),
                       "loop_samples":len(err), "initial_sample_excluded":True}
    table = []
    for t,r,b in [(9.5,11.46,-9.958),(9.5625,9806,-9358),(9.625,10.41,-10.91)]:
        row = rows[int(t/h)]
        table.append({"time":t,"published":[r,b],
                      "hypotheses": {k:d["raw_loop_scores"] for k,d in row["hypotheses"].items()}})
    return {"source_blobs":[BASS_JSON,BASS_XML],"rows":rows,"errors":errors,
            "paper_table3_interior":table}


def controls():
    cases = {"additive": (lambda x,y:2*x+y,(2,3),(3,9)),
             "product": (lambda x,y:x*y,(2,3),(3,9)),
             "asymmetric": (lambda x,y:x*x*y,(2,3),(3,9)),
             "cancellation": (lambda x,y:x-y,(2,3),(3,4)),
             "negative_polarity": (lambda x,y:x-y,(2,3),(3,5)),
             "unchanged_input": (lambda x,y:x*y,(2,3),(2,9))}
    return {name:{mode:partials(fn,old,new,mode) for mode in ("first","last")}
            for name,(fn,old,new) in cases.items()}


def report(ref_dir):
    return {"admitted":False,"kind":"independent_mathematical_controls",
            "controls":controls(),"flow_tables":flow_tables(),
            "pulse":pulse_rows(),"pulse_coupled":pulse_rows(coupled=True),"bass":bass(ref_dir)}


if __name__ == "__main__":
    print(json.dumps(report(Path(sys.argv[1])),allow_nan=False,indent=2))
