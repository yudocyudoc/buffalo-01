"""Finite-change attribution for a scalar product on the original sample grid."""
import numpy as np


def product_link_score(source, cofactor, target, *, changed_last):
    """Signed raw link score for target = source * cofactor (LTM equation 2)."""
    dx = np.diff(source)
    dz = np.diff(target)
    held = cofactor[1:] if changed_last else cofactor[:-1]
    # The partial change is dx * held. Its sign relative to dx is sign(held).
    scores = np.zeros(len(target))
    np.divide(np.abs(dx) * held, np.abs(dz), out=scores[1:], where=dz != 0)
    return scores
