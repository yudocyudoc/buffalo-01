import unittest
from representation_diagnostics import cycle, index, inventory, market
import hashlib

class DiagnosticsTests(unittest.TestCase):
    def test_cycle_collision(self):
        with self.assertRaises(ValueError):
            index([{"cycle":["a","b"]},{"cycle":["b","a"]}],cycle)

    def test_scope_is_not_guessed(self):
        a={"cycle":["a"],"id":"B1","group":"one"}
        b={"cycle":["b"],"id":"B1","group":"two"}
        d={"case":"inventoryWorkforce","reference_time":[0],"native_time":[0],"ltm_mode":"exhaustive","admitted":False,
           "reference_loops":[a,b],"native_loops":[a,b],"reference_periods":[{"dominantLoops":["B1"]}]}
        self.assertEqual(inventory(d)["status"],"AMBIGUOUS_PERIOD_SCOPE")

    def test_wrong_market_bytes_rejected(self):
        d={"case":"marketGrowth","reference_time":[0],"native_time":[0],"ltm_mode":"exhaustive","admitted":False,
           "source":{"stmx_sha256":hashlib.sha256(b"expected").hexdigest()}}
        with self.assertRaisesRegex(ValueError,"source identity"):
            market(d,b"changed")

if __name__=="__main__":
    unittest.main()
