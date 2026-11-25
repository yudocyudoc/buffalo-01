"""A3: independent directed-cycle enumeration and stock SCC partitions.

Restricted scalar XMILE dependency extractor; no claim of general parsing.
All authored equations and structural edges are retained. No simulation engine
is imported by the graph oracle or its unit tests.
"""
import hashlib
import json
import re
from pathlib import Path
import tempfile
import xml.etree.ElementTree as ET

NS = "{http://docs.oasis-open.org/xmile/ns/XMILE/v1.0}"
MAIBAB = ("f4bff97ff2de1d464afc216602734e1fef4f9183",
          "623ab6a83a91caa8d810b2cd4b71d7c0ba63fa3f")
TOKEN = re.compile(r"\s+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z_0-9]*|[()+*/,\-]")
IDENT = re.compile(r"[A-Za-z_][A-Za-z_0-9]*")


def require(ok, message):
    if not ok:
        raise ValueError(message)


def canon(name):
    return re.sub(r"\s+", "_", name.strip().casefold())


def signature(nodes):
    a=tuple(nodes)
    require(a and len(set(a))==len(a),"invalid elementary cycle")
    return min(a[i:]+a[:i] for i in range(len(a)))


def dependencies(eqn, names):
    """Scalar arithmetic and STEP only. Refuse unknown grammar tokens."""
    pos=0
    refs=set()
    while pos<len(eqn):
        m=TOKEN.match(eqn,pos)
        require(m is not None,"unsupported token in "+eqn)
        token=m.group()
        pos=m.end()
        if IDENT.fullmatch(token):
            key=canon(token)
            if key in names:
                refs.add(key)
            else:
                require(key=="step" and eqn[pos:].lstrip().startswith("("),
                        "unknown reference or function "+token)
    return refs


def authored_graph(raw):
    root=ET.fromstring(raw)
    vs=root.findall(NS+"model/"+NS+"variables")
    require(len(vs)==1,"only a single flat model supported")
    nodes={}
    for v in vs[0]:
        kind=v.tag.removeprefix(NS)
        require(kind in ("stock","flow","aux"),"unsupported variable type "+kind)
        name=canon(v.attrib["name"])
        require(name not in nodes and v.find(NS+"dimensions") is None and
                v.find(NS+"element") is None,"array or duplicate variable")
        eq=v.findtext(NS+"eqn")
        require(eq is not None,"missing equation")
        nodes[name]={"kind":kind,"equation":eq,"graphical_function":v.find(NS+"gf") is not None}
    edges=set()
    stocks={n for n,v in nodes.items() if v["kind"]=="stock"}
    for v in vs[0]:
        n=canon(v.attrib["name"])
        refs=dependencies(nodes[n]["equation"],nodes)
        if n in stocks:
            # Stock equations are initial conditions, not dynamic dependencies.
            nodes[n]["initial_dependencies"]=sorted(refs)
            for tag in ("inflow","outflow"):
                for f in v.findall(NS+tag):
                    k=canon(f.text)
                    require(k in nodes and nodes[k]["kind"]=="flow","unknown flow")
                    edges.add((k,n))
        else:
            edges.update((r,n) for r in refs)
    return nodes,edges,stocks


def cycles(nodes,edges,limit=10000):
    """Brute-force simple paths with smallest-node anchor, independent of Johnson."""
    require(len(nodes)<=40,"small-graph oracle bound")
    adj={n:[] for n in nodes}
    for a,b in sorted(edges):
        require(a in adj and b in adj,"edge outside graph")
        adj[a].append(b)
    found=set()
    visits=0
    def visit(start,path,seen):
        nonlocal visits
        visits+=1
        require(visits<=1000000,"path search budget exceeded")
        for nxt in adj[path[-1]]:
            if nxt==start:
                found.add(tuple(path))
                require(len(found)<=limit,"cycle budget exceeded")
            elif nxt>start and nxt not in seen:
                visit(start,path+[nxt],seen|{nxt})
    for n in sorted(nodes):
        visit(n,[n],{n})
    return found


def stock_partitions(nodes,edges,stocks,loops):
    """Mutual reachability, per 2020 paper; independent of native IDs."""
    adj={n:set() for n in nodes}
    for a,b in edges:
        adj[a].add(b)
    def reach(n):
        seen={n}
        todo=[n]
        while todo:
            nxt=adj[todo.pop()]-seen
            seen.update(nxt)
            todo.extend(nxt)
        return seen
    reachs={n:reach(n) for n in stocks}
    groups={tuple(sorted(s for s in stocks if s in reachs[n] and n in reachs[s]))
            for n in stocks}
    result={}
    for loop in loops:
        members=set(loop)&stocks
        require(members,"stockless cycle outside audit scope")
        choices=[g for g in groups if members<=set(g)]
        require(len(choices)==1,"ambiguous stock partition")
        result[loop]=choices[0]
    return result


def graph_report(raw):
    nodes,edges,stocks=authored_graph(raw)
    loops=cycles(nodes,edges)
    parts=stock_partitions(nodes,edges,stocks,loops)
    return {"variables":nodes,"edges":[list(e) for e in sorted(edges)],
            "stocks":sorted(stocks),
            "cycles":[{"cycle":list(c),"stock_partition":list(parts[c])} for c in sorted(loops)]}


def synthetic(reciprocal):
    a="1+x"+("+y" if reciprocal else "")
    return ('''<?xml version="1.0"?>
<xmile xmlns="http://docs.oasis-open.org/xmile/ns/XMILE/v1.0" version="1.0">
<header><smile version="1.0" namespace="std"/><name>A3 partition</name><vendor>Buffalo research</vendor><product version="1.0">A3 control</product></header>
<sim_specs method="Euler" time_units="Day"><start>0</start><stop>5</stop><dt>1</dt></sim_specs>
<model><variables>
<stock name="x"><eqn>1</eqn><inflow>fx</inflow></stock>
<stock name="y"><eqn>2</eqn><inflow>fy</inflow></stock>
<flow name="fx"><eqn>'''+a+'''</eqn></flow>
<flow name="fy"><eqn>1+y+x</eqn></flow>
</variables></model></xmile>''').encode()


def reference_graph(data):
    groups={}
    for l in data["feedback"]["feedbackLoops"]:
        links=l["links"]
        require(links and all(canon(e["to"])==canon(links[(i+1)%len(links)]["from"])
                              for i,e in enumerate(links)),"reference cycle not directed")
        c=signature([canon(e["from"]) for e in links])
        require(c not in groups,"duplicate reference cycle")
        groups[c]=l.get("loopset","whole-model")
    return groups


def compare(graph,native,reference=None):
    expected={tuple(c["cycle"]):tuple(c["stock_partition"]) for c in graph["cycles"]}
    got={signature(l["cycle"]):l["partition"] for l in native["loops"]}
    require(len(got)==len(native["loops"]),"duplicate native cycles")
    def groups(mapping):
        g={}
        for c,p in mapping.items():
            require(p is not None,"missing partition")
            g.setdefault(p,set()).add(c)
        return {frozenset(v) for v in g.values()}
    def describe(c):
        return {"cycle":list(c),"authored_edges":all([a,b] in graph["edges"]
                 for a,b in zip(c,c[1:]+c[:1])),
                "authored_stock_partition":list(expected[c]) if c in expected else None}
    result={"native_mode":native["ltm_mode"],"authored_count":len(expected),"native_count":len(got),
            "authored_only":[describe(c) for c in sorted(expected.keys()-got.keys())],
            "native_only":[describe(c) for c in sorted(got.keys()-expected.keys())],
            "same_cycles":expected.keys()==got.keys(),
            "same_partition_membership":groups(expected)==groups(got)}
    if reference is not None:
        result.update(reference_count=len(reference),
                      authored_not_in_reference=[describe(c) for c in sorted(expected.keys()-reference.keys())],
                      native_not_in_reference=[describe(c) for c in sorted(got.keys()-reference.keys())],
                      reference_not_authored=[list(c) for c in sorted(reference.keys()-expected.keys())],
                      reference_partition_membership_matches_authored=groups(reference)==groups(expected),
                      reference_groups=[{"cycle":list(c),"group":g} for c,g in sorted(reference.items())])
        # Report stock partition of reference cycles, without renormalizing a subset.
        result["reference_groups_to_authored_stock_sets"]={
            g:sorted({expected[c] for c,r in reference.items() if r==g and c in expected})
            for g in sorted(set(reference.values()))}
    return result


def normalization(native):
    t=native["time"]
    groups={}
    for l in native["loops"]:
        require(l["partition"] is not None,"missing partition")
        require(len(l["relative"])==len(t),"series size")
        groups.setdefault(l["partition"],[]).append(l["relative"])
    out=[]
    for p,series in groups.items():
        require(all(v is not None for s in series for v in s),"missing relative sample")
        sums=[sum(abs(s[i]) for s in series) for i in range(len(t))]
        out.append({"partition":p,"absolute_sums":sums,"max_error":max(min(abs(v),abs(v-1)) for v in sums)})
    return out


def main():
    import importlib.metadata as md
    import simlin
    from benchmark import blob,prepare_source_xml,load_native
    from native_probe import measure
    require(md.version("pysimlin")=="0.8.5","version drift")
    out={"admitted":False,"backend":md.version("pysimlin"),"cases":{}}
    for name in ("one_way","reciprocal","maibab"):
        d={}
        out["cases"][name]=d
        try:
            ref=None
            if name=="maibab":
                xb=Path("/reference/maibab.stmx").read_bytes()
                jb=Path("/reference/maibab.json").read_bytes()
                require((blob(jb),blob(xb))==MAIBAB,"fixture drift")
                raw=prepare_source_xml("maibab",xb,d)
                ref=reference_graph(json.loads(jb))
            else:
                raw=synthetic(name=="reciprocal")
            d["graph_source_sha256"]=hashlib.sha256(raw).hexdigest()
            d["authored"]=graph_report(raw)
            with tempfile.TemporaryDirectory() as td:
                p=Path(td)/(name+".xmile")
                model=load_native(p,raw,d)
                d["native"]=measure(model)
            d["comparison"]=compare(d["authored"],d["native"],ref)
            d["normalization"]=normalization(d["native"])
            d["status"]="OBSERVED"
        except Exception as e:
            d.update(status="EXECUTION_FAILURE",error=type(e).__name__+": "+str(e))
    print(json.dumps(out,allow_nan=False,indent=2))
    if any(d["status"]!="OBSERVED" for d in out["cases"].values()):
        raise SystemExit(1)

if __name__=="__main__":
    main()
