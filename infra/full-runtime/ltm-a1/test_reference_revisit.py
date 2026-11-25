import unittest
from reference_revisit import full_grid_copy,reference_clock,pair,predator_values,predator_oracle,lookup
from clock_audit import clock_xml


class Tests(unittest.TestCase):
    def test_save_only(self):
        raw=clock_xml("RK4",1)
        dense,receipt=full_grid_copy(raw,.25)
        self.assertEqual(receipt["kind"],"save-interval-only")
        self.assertEqual(dense,raw.replace(b'save_interval="1"',b'save_interval="0.25"'))
        self.assertEqual(full_grid_copy(dense,.25)[0],dense)

    def test_lookup_and_predator(self):
        self.assertEqual(lookup(-1,(0,1,2),1),0)
        self.assertEqual(lookup(3,(0,1,2),1),2)
        self.assertAlmostEqual(lookup(.5,(0,1,2),1),.5)
        v=predator_values(50000,850)
        self.assertEqual(v["hare_births"],62500)
        self.assertEqual(v["hare_deaths"],42500)
        self.assertEqual(v["lynx_births"],212.5)
        self.assertEqual(v["lynx_deaths"],212.5)
        self.assertEqual(len(predator_oracle()),3201)

    def fixture(self,t,s):
        return {"time":t,"trajectory":{"x":t},"links":[{"from":"x","to":"f","raw":s}],
                "loops":[{"cycle":["f","x"],"relative":s,"partition":0}]}

    def test_sampling(self):
        a=self.fixture([0,2,4],[0,.4,.8])
        b=self.fixture([0,1,2,3,4],[0,.2,.4,.6,.8])
        self.assertEqual(pair(a,b)["relative_max_abs_error"],0)
        self.assertEqual(pair(a,b)["raw_max_abs_error"],0)

    def test_clock_diagnostic(self):
        b=self.fixture([0,1,2,3,4],[0,.2,.4,.6,.8])
        ref={("f","x"):{"group":"all","id":"R","scores":[0,60,80]}}
        d=reference_clock(b,[0,2,4],ref)
        self.assertEqual(d["hypotheses"]["1"]["max_pp"],0)
        self.assertEqual(d["hypotheses"]["0"]["max_pp"],20)
        self.assertEqual(d["common_reference_times"],[2])
        ref[("q","x")]=ref.pop(("f","x"))
        self.assertEqual(reference_clock(b,[0,2,4],ref)["status"],
                         "NOT_COMPARABLE_TOPOLOGY_OR_DENOMINATOR")

if __name__=="__main__":
    unittest.main()
