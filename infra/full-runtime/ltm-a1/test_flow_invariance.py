import copy
import unittest
import xml.etree.ElementTree as ET
from flow_invariance import oracle, xml, adjudicate, pair, DIRECT, NET, TIMES


def fixture(net):
    # Artificial comparator input only, not native evidence.
    rows=oracle()
    edges={("s","inflow_rate"):1.,("s","outflow_rate"):1.}
    if net:
        edges.update({("inflow_rate","net_rate"):1.25,("outflow_rate","net_rate"):-.25,
                      ("net_rate","s"):1.})
    else:
        edges.update({("inflow_rate","s"):1.25,("outflow_rate","s"):-.25})
    return {"time":TIMES,"ltm_mode":"exhaustive",
            "trajectory":{k:[r[k] for r in rows] for k in ("s","inflow_rate","outflow_rate","net_rate")},
            "links":[{"from":a,"to":b,"raw":[0]+[v]*5} for (a,b),v in edges.items()],
            "loops":[{"cycle":list(v),"partition":0,"relative":[0]+[q]*5}
                     for v,q in zip((NET if net else DIRECT).values(),(5/6,-1/6))]}


class Tests(unittest.TestCase):
    def test_oracle(self):
        r=oracle()
        self.assertEqual([v["s"] for v in r],[100,101,106,131,256,881])
        self.assertEqual([r[0]["inflow_rate"],r[0]["outflow_rate"]],[5,4])
        self.assertEqual([r[1]["inflow_rate"],r[1]["outflow_rate"]],[10,5])
        self.assertEqual(r[1]["delta_net"],4)
        self.assertEqual(r[1]["raw"],[1.25,-.25])
        self.assertEqual(r[1]["old_formula_diagnostic"],[2,-1])
        self.assertEqual(r[1]["relative"],[5/6,-1/6])
        self.assertTrue(all(v["raw"]==[1.25,-.25] for v in r[1:]))

    def test_material_representation(self):
        ns={"x":"http://docs.oasis-open.org/xmile/ns/XMILE/v1.0"}
        a,b=[ET.fromstring(xml(v)).find("x:model/x:variables",ns) for v in (False,True)]
        self.assertEqual(a.find("x:stock/x:outflow",ns).text,"outflow_rate")
        self.assertEqual(b.find("x:stock/x:inflow",ns).text,"net_rate")
        self.assertIsNone(b.find("x:stock/x:outflow",ns))
        self.assertEqual(b.find("x:flow/x:eqn",ns).text,"inflow_rate-outflow_rate")

    def test_pair_and_negative_old_formula(self):
        a=adjudicate(fixture(False),False)
        b=adjudicate(fixture(True),True)
        self.assertTrue(pair(a,b)["both_match_corrected_oracle"])
        self.assertTrue(pair(a,b)["invariant_on_observed_support"])
        wrong=fixture(False)
        next(l for l in wrong["links"] if l["from"]=="inflow_rate")["raw"][1]=2
        self.assertFalse(adjudicate(wrong,False)["matches_oracle"])
        self.assertFalse(pair(adjudicate(wrong,False),b)["invariant_on_observed_support"])

    def test_missing_is_not_zero(self):
        a=fixture(False)
        a["links"][0]["raw"]=None
        with self.assertRaisesRegex(ValueError,"missing raw link"):
            adjudicate(a,False)
        a=fixture(True)
        a["loops"][0]["partition"]=1
        with self.assertRaisesRegex(ValueError,"unexpected loop partition"):
            adjudicate(a,True)

if __name__=="__main__":
    unittest.main()
