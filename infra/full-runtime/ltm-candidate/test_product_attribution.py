import unittest

import numpy as np
from numpy.testing import assert_allclose

from product_attribution import product_link_score


class ProductAttributionTest(unittest.TestCase):
    def test_asymmetric_product_including_last_sample(self):
        x = np.array([2, 4, 3])
        y = np.array([3, 5, -1])
        z = x * y
        # At step one z moves 6 -> 20. Freeze x at 2 with y=5: 20-10=10.
        # Freeze y at 3 with x=4: 20-12=8. Step two also changes polarity.
        for source, held, first, last in [
            (x, y, [0, 6/14, 5/23], [0, 10/14, -1/23]),
            (y, x, [0, 4/14, 24/23], [0, 8/14, 18/23]),
        ]:
            assert_allclose(product_link_score(source, held, z, changed_last=False), first)
            assert_allclose(product_link_score(source, held, z, changed_last=True), last)

    def test_unchanged_target_then_unchanged_source(self):
        x, y = np.array([2, 3, 3]), np.array([3, 2, 4])
        for convention in [False, True]:
            assert_allclose(product_link_score(x, y, x*y, changed_last=convention), [0, 0, 0])
            assert_allclose(product_link_score(y, x, x*y, changed_last=convention), [0, 0, 1])


if __name__ == "__main__":
    unittest.main()
