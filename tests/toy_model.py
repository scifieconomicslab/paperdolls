"""A tiny model that is not about housing, used to test that the pipeline works for other models.

SIR spread on a ring of households. Buildings carry `wealth` (set for even ids only) and an owner; households carry `income`.
"""
import random
from dataclasses import dataclass

import numpy as np


@dataclass
class Params:
    n: int = 12
    run_time: int = 6
    seed: int = 1
    beta: float = 0.4
    gamma: float = 0.2


class Building:
    def __init__(self, i):
        self.id, self.state, self.owner_id = i, "to_do", (i if i % 3 else None)   # to_do = S, queued = E, in_progress = I, finished = R
        if i % 2 == 0:
            self.wealth = float(i)


class Household:
    def __init__(self, i):
        self.income = 1000.0 + i


class Result:
    pass


def run_simulation(p, on_week=None):
    rng = random.Random(p.seed)
    bs = [Building(i) for i in range(p.n)]
    hh = {i: Household(i) for i in range(p.n)}
    bs[0].state = "in_progress"
    for t in range(p.run_time):
        nxt = [b.state for b in bs]
        for i, b in enumerate(bs):
            if b.state == "in_progress":
                for j in (i - 1, (i + 1) % p.n):
                    if bs[j].state == "to_do" and rng.random() < p.beta:
                        nxt[j] = "in_progress"
                if rng.random() < p.gamma:
                    nxt[i] = "finished"
        for b, s in zip(bs, nxt):
            b.state = s
        if on_week:
            on_week(t, bs, hh, [])
    r = Result()
    r.total_weeks, r.finished = p.run_time, sum(b.state == "finished" for b in bs)
    return r
