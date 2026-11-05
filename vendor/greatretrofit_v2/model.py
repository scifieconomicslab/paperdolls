# Vendored from the Great Retrofit v2 notebook (TheGreatRetrofit_v2.ipynb, code cells 2-20).
# Changes from upstream: (1) optional on_week hook in run_simulation, default None; (2) plotting imports, a global
# theme change, a machine-specific sys.path line and an unseeded global rng removed. Results are unchanged.
# import packages
import numpy as np
import random
import copy
from typing import List, Dict, Optional, Any
from dataclasses import dataclass, field



"""Parameter validation utilities."""
from dataclasses import fields
from typing import Any


def validate_positive(value: float, name: str) -> None:
    """Validate that a value is positive."""
    if value <= 0:
        raise ValueError(f"{name} must be positive, got {value}")


def validate_nonnegative(value: float, name: str) -> None:
    """Validate that a value is non-negative."""
    if value < 0:
        raise ValueError(f"{name} must be non-negative, got {value}")


def validate_probability(value: float, name: str) -> None:
    """Validate that a value is a valid probability [0, 1]."""
    if not 0 <= value <= 1:
        raise ValueError(f"{name} must be in [0, 1], got {value}")


def validate_integer_positive(value: int, name: str) -> None:
    """Validate that a value is a positive integer."""
    if not isinstance(value, int) or value <= 0:
        raise ValueError(f"{name} must be a positive integer, got {value}")


def validate_dataclass_positive(obj: Any, field_names: list[str]) -> None:
    """Validate that specified fields of a dataclass are positive."""
    for field_name in field_names:
        value = getattr(obj, field_name)
        validate_positive(value, field_name)


def validate_dataclass_nonnegative(obj: Any, field_names: list[str]) -> None:
    """Validate that specified fields of a dataclass are non-negative."""
    for field_name in field_names:
        value = getattr(obj, field_name)
        validate_nonnegative(value, field_name)

"""Parameter dataclass for v2 retrofit model."""
from dataclasses import dataclass
from typing import Optional




@dataclass(frozen=True)
class Params:
    """Parameters for the v2 retrofit co-op simulation.

    Base parameters (from v1):
        n: Total number of buildings needing retrofit.
        n_co_ops: Number of retrofit cooperatives.
        E: Initial endowment per co-op (euros).
        tau: Mean weekly request rate (Poisson).
        surplus: Co-op surplus rate (fraction, e.g., 0.2 for 20%).
        mean_time: Mean retrofit duration in weeks.
        time_var: Variance in retrofit duration (uniform range ±time_var).
        week_cost: Weekly cost per active project (euros).
        run_time: Maximum simulation time in weeks.
        seed: Random seed for reproducibility.

    New v2 parameters:
        n_households: Number of households (building owners).
        income_mean: Mean household income (€/year).
        income_cv: Coefficient of variation for income (lognormal).
        wealth_pareto_alpha: Pareto shape parameter for initial wealth.
        aspiration_mean: Mean aspiration level (0-100).
        aspiration_sd: Standard deviation of aspiration.
        search_length: Number of co-ops a household considers (default: all).
        n_neighbourhoods: Number of neighbourhoods for spatial structure.
    """
    # Base parameters
    n: int
    n_co_ops: int
    E: float
    tau: float
    surplus: float
    mean_time: float
    time_var: float
    week_cost: float
    run_time: int
    seed: Optional[int] = None

    # Household parameters
    n_households: int = 1000
    income_mean: float = 50000.0
    income_cv: float = 0.4
    wealth_pareto_alpha: float = 1.5
    aspiration_mean: float = 50.0
    aspiration_sd: float = 15.0

    # Search/matching parameters
    search_length: int = 0  # 0 = all co-ops

    # Spatial parameters
    n_neighbourhoods: int = 1

    # Bargaining parameters
    enable_bargaining: bool = False
    max_bid_shade: float = 0.2  # Max fraction below asking price buyers can bid
    seller_reservation_pct: float = 0.8  # Min fraction of asking price sellers accept

    # Bank parameters
    n_banks: int = 0
    bank_ltv_mean: float = 0.8
    bank_ltv_sd: float = 0.05
    bank_spread_mean: float = 0.02
    bank_spread_sd: float = 0.005

    # Default parameters
    enable_default: bool = False

    # Local demand parameters
    enable_local_demand: bool = False

    # Income process parameters
    income_ar1_rho: float = 0.0  # 0 = no AR(1) process
    income_shock_sd: float = 0.0
    unemployment_prob: float = 0.0

    # Investor market parameters
    enable_investors: bool = False
    investor_hurdle_mean: float = 0.05
    investor_hurdle_sd: float = 0.01

    # Stock evolution parameters
    enable_construction: bool = False
    build_cost: float = 150000.0
    construction_lag_weeks: int = 52
    depreciation_rate: float = 0.01  # Annual

    # Demographics parameters
    enable_demographics: bool = False
    birth_rate: float = 0.01
    death_rate: float = 0.01

    # Expectations parameters
    enable_heterogeneous_expectations: bool = False
    extrapolator_share: float = 0.5

    # Transaction costs
    transaction_cost_pct: float = 0.05
    moving_cost: float = 10000.0

    def __post_init__(self) -> None:
        # Base validation
        validate_integer_positive(self.n, "n")
        validate_integer_positive(self.n_co_ops, "n_co_ops")
        validate_positive(self.E, "E")
        validate_positive(self.tau, "tau")
        validate_probability(self.surplus, "surplus")
        validate_positive(self.mean_time, "mean_time")
        validate_nonnegative(self.time_var, "time_var")
        validate_positive(self.week_cost, "week_cost")
        validate_integer_positive(self.run_time, "run_time")
        if self.seed is not None:
            validate_integer_positive(self.seed, "seed")

        # Household validation
        validate_integer_positive(self.n_households, "n_households")
        validate_positive(self.income_mean, "income_mean")
        validate_nonnegative(self.income_cv, "income_cv")
        validate_positive(self.wealth_pareto_alpha, "wealth_pareto_alpha")
        validate_nonnegative(self.aspiration_mean, "aspiration_mean")
        validate_nonnegative(self.aspiration_sd, "aspiration_sd")

        # Search validation
        validate_nonnegative(self.search_length, "search_length")

        # Spatial validation
        validate_integer_positive(self.n_neighbourhoods, "n_neighbourhoods")

        # Bargaining validation
        if self.enable_bargaining:
            validate_probability(self.max_bid_shade, "max_bid_shade")
            validate_probability(self.seller_reservation_pct, "seller_reservation_pct")

        # Bank validation
        validate_nonnegative(self.n_banks, "n_banks")
        if self.n_banks > 0:
            validate_integer_positive(self.n_banks, "n_banks")
            validate_probability(self.bank_ltv_mean, "bank_ltv_mean")
            validate_nonnegative(self.bank_ltv_sd, "bank_ltv_sd")
            validate_nonnegative(self.bank_spread_mean, "bank_spread_mean")
            validate_nonnegative(self.bank_spread_sd, "bank_spread_sd")

        # Income process validation
        if self.income_ar1_rho > 0:
            validate_probability(self.income_ar1_rho, "income_ar1_rho")
            validate_nonnegative(self.income_shock_sd, "income_shock_sd")
            validate_probability(self.unemployment_prob, "unemployment_prob")

        # Investor validation
        if self.enable_investors:
            validate_positive(self.investor_hurdle_mean, "investor_hurdle_mean")
            validate_nonnegative(self.investor_hurdle_sd, "investor_hurdle_sd")

        # Construction validation
        if self.enable_construction:
            validate_positive(self.build_cost, "build_cost")
            validate_integer_positive(self.construction_lag_weeks, "construction_lag_weeks")
            validate_nonnegative(self.depreciation_rate, "depreciation_rate")

        # Demographics validation
        if self.enable_demographics:
            validate_probability(self.birth_rate, "birth_rate")
            validate_probability(self.death_rate, "death_rate")

        # Expectations validation
        if self.enable_heterogeneous_expectations:
            validate_probability(self.extrapolator_share, "extrapolator_share")

        # Transaction costs validation
        validate_probability(self.transaction_cost_pct, "transaction_cost_pct")
        validate_nonnegative(self.moving_cost, "moving_cost")


"""Random number generation utilities."""
import numpy as np


def make_rng(seed: int | None = None) -> np.random.Generator:
    """Create a NumPy random Generator with the given seed."""
    if seed is None:
        return np.random.default_rng()
    return np.random.default_rng(seed)


"""Household agents for v2 retrofit model."""
import numpy as np
from dataclasses import dataclass, field
from typing import List, Optional





@dataclass
class Household:
    """A household (building owner) in the retrofit market.

    Attributes:
        id: Unique identifier.
        income: Annual income (€).
        wealth: Current wealth/savings (€).
        aspiration: Aspiration level (0-100), probability of requesting retrofit.
        affordability: Maximum fraction of income for retrofit payments.
        taste_weights: Weights for building attributes [size, age, location].
        taste_shock: Random taste shock for each building.
        neighbourhood: Neighbourhood index.
        building_id: ID of owned building (if any).
        age: Age of household head.
        is_investor: Whether this household is an investor/landlord.
        hurdle_rate: Required return for investment (if investor).
        expectations_type: 'extrapolator' or 'fundamentalist'.
        unemployed: Whether currently unemployed.
        income_history: List of past income values.
    """
    id: int
    income: float
    wealth: float
    aspiration: float
    affordability: float
    taste_weights: np.ndarray  # shape (3,)
    taste_shock: float
    neighbourhood: int
    building_id: Optional[int] = None
    age: int = 30
    is_investor: bool = False
    hurdle_rate: float = 0.05
    expectations_type: str = 'fundamentalist'
    unemployed: bool = False
    income_history: List[float] = field(default_factory=list)

    def wants_retrofit(self, rng: np.random.Generator) -> bool:
        """Decide whether to request a retrofit this week."""
        return rng.random() < (self.aspiration / 100.0)

    def utility_for_building(self, building: 'Building') -> float:
        """Calculate utility for a specific building."""
        # Utility = weighted sum of attributes + taste shock
        attrs = np.array([building.size, -building.age, building.location_quality])
        return float(np.dot(self.taste_weights, attrs) + self.taste_shock)

    def max_affordable_cost(self) -> float:
        """Maximum total cost household can afford."""
        return self.affordability * self.income

    def can_afford(self, cost: float) -> bool:
        """Check if household can afford a retrofit of given cost."""
        return cost <= self.max_affordable_cost()

    def bid_price(self, asking_price: float, params: 'Params', rng: np.random.Generator) -> float:
        """Calculate bid price below asking price based on willingness to pay.

        Args:
            asking_price: The asking price (retrofit cost).
            params: Simulation parameters.
            rng: Random number generator.

        Returns:
            Bid price (may be lower than asking).
        """
        if not params.enable_bargaining:
            return asking_price

        # Bid shade: random up to max_bid_shade based on affordability pressure
        affordability_pressure = 1.0 - (self.wealth / max(1, self.max_affordable_cost()))
        affordability_pressure = np.clip(affordability_pressure, 0, 1)

        max_shade = params.max_bid_shade * affordability_pressure
        shade = rng.uniform(0, max_shade)

        bid = asking_price * (1 - shade)
        # Don't bid more than can afford
        return min(bid, self.max_affordable_cost())

    def reservation_price(self, asking_price: float, params: 'Params') -> float:
        """Minimum price household would accept as seller (not used for owners, but for symmetry)."""
        return asking_price * params.seller_reservation_pct

    def update_income(self, params: 'Params', rng: np.random.Generator) -> None:
        """Update income based on AR(1) process with unemployment shocks.

        Args:
            params: Simulation parameters.
            rng: Random number generator.
        """
        if params.income_ar1_rho == 0:
            return

        # Record current income
        self.income_history.append(self.income)

        # Unemployment shock
        if not self.unemployed and rng.random() < params.unemployment_prob:
            self.unemployed = True
            self.income *= 0.3  # Unemployment benefit ~30% of income
        elif self.unemployed and rng.random() < 0.1:  # 10% chance to find job per week
            self.unemployed = False
            # Income recovers with AR(1) process
            log_income = np.log(self.income)
            shock = rng.normal(0, params.income_shock_sd)
            log_income = params.income_ar1_rho * log_income + (1 - params.income_ar1_rho) * np.log(params.income_mean) + shock
            self.income = np.exp(log_income)
        elif not self.unemployed:
            # Normal AR(1) income process
            log_income = np.log(self.income)
            shock = rng.normal(0, params.income_shock_sd)
            log_income = params.income_ar1_rho * log_income + (1 - params.income_ar1_rho) * np.log(params.income_mean) + shock
            self.income = np.exp(log_income)

    def wants_investment(self, building: 'Building', params: 'Params', rng: np.random.Generator) -> bool:
        """Decide whether to purchase building as investment.

        Args:
            building: Building to evaluate.
            params: Simulation parameters.
            rng: Random number generator.

        Returns:
            True if household wants to invest.
        """
        if not params.enable_investors or not self.is_investor:
            return False

        # Expected rental yield
        # Simplified: rent = 5% of building value per year
        rent = building.retrofit_cost * 0.05
        yield_rate = rent / building.retrofit_cost

        # Adjust expectations
        if self.expectations_type == 'extrapolator':
            # Extrapolate recent price growth (simplified)
            expected_growth = 0.02  # 2% annual
        else:
            expected_growth = 0.0

        expected_return = yield_rate + expected_growth
        return expected_return > self.hurdle_rate

    def age_one_week(self) -> None:
        """Age the household by one week."""
        self.age += 1 / 52.0


def create_households(params: Params, rng: np.random.Generator) -> List[Household]:
    """Create all households with heterogeneous attributes.

    Args:
        params: Simulation parameters.
        rng: Random number generator.

    Returns:
        List of Household objects.
    """
    n = params.n_households

    # Income: lognormal with given mean and CV
    sigma = np.sqrt(np.log(1 + params.income_cv**2))
    mu = np.log(params.income_mean) - sigma**2 / 2
    incomes = rng.lognormal(mu, sigma, n)

    # Wealth: Pareto distribution (independent of income)
    wealth_scale = params.income_mean / 10.0
    u = rng.random(n)
    wealths = wealth_scale * (1 - u)**(-1.0 / params.wealth_pareto_alpha)

    # Aspiration: truncated normal around aspiration_mean
    aspirations = rng.normal(params.aspiration_mean, params.aspiration_sd, n)
    aspirations = np.clip(aspirations, 0, 100)

    # Affordability: truncated normal around 0.33 (33% of income)
    affordability = rng.normal(0.33, 0.1, n)
    affordability = np.clip(affordability, 0.05, 0.6)

    # Taste weights: Dirichlet distribution for [size, -age, location]
    taste_weights = rng.dirichlet([2.0, 2.0, 2.0], n)

    # Taste shocks: normal
    taste_shocks = rng.normal(0, 0.5, n)

    # Neighbourhood assignment
    neighbourhoods = rng.integers(0, params.n_neighbourhoods, n)

    # Ages: uniform 25-75
    ages = rng.integers(25, 75, n)

    # Investor status
    is_investor = rng.random(n) < 0.15  # 15% are investors

    # Hurdle rates for investors
    hurdle_rates = rng.normal(params.investor_hurdle_mean, params.investor_hurdle_sd, n)
    hurdle_rates = np.clip(hurdle_rates, 0.02, 0.15)

    # Expectations type
    expectations = np.where(
        rng.random(n) < params.extrapolator_share,
        'extrapolator',
        'fundamentalist'
    )

    households = []
    for i in range(n):
        h = Household(
            id=i,
            income=incomes[i],
            wealth=wealths[i],
            aspiration=aspirations[i],
            affordability=affordability[i],
            taste_weights=taste_weights[i],
            taste_shock=taste_shocks[i],
            neighbourhood=neighbourhoods[i],
            age=ages[i],
            is_investor=is_investor[i],
            hurdle_rate=hurdle_rates[i],
            expectations_type=expectations[i],
        )
        h.income_history.append(incomes[i])
        households.append(h)

    return households


"""Building agents for v2 retrofit model."""
import numpy as np
from dataclasses import dataclass
from typing import List, Optional





@dataclass
class Building:
    """A building needing retrofit.

    Attributes:
        id: Unique identifier.
        size: Size factor (1.0 = baseline).
        age: Age in years.
        location_quality: Location amenity score (0-1).
        neighbourhood: Neighbourhood index.
        retrofit_time: Weeks needed for retrofit.
        retrofit_cost: Total cost for retrofit.
        owner_id: ID of household that owns this building.
        state: Current state ('to_do', 'queued', 'in_progress', 'finished').
        assigned_coop: ID of assigned co-op (if any).
        weeks_remaining: Weeks left in retrofit.
        condition: Building condition (0-1, 1 = perfect).
        depreciated_value: Current depreciated value.
    """
    id: int
    size: float
    age: float
    location_quality: float
    neighbourhood: int
    retrofit_time: int
    retrofit_cost: float
    owner_id: int
    state: str = 'to_do'
    assigned_coop: Optional[int] = None
    weeks_remaining: int = 0
    condition: float = 1.0
    depreciated_value: float = 0.0


def create_buildings(params: Params, households, rng: np.random.Generator):
    """Create buildings with heterogeneous attributes.

    Args:
        params: Simulation parameters.
        households: List of Household objects.
        rng: Random number generator.

    Returns:
        List of Building objects.
    """
    n = params.n

    # Building attributes
    # Size: lognormal around 1.0
    sizes = rng.lognormal(0, 0.3, n)

    # Age: uniform 0-80 years
    ages = rng.uniform(0, 80, n)

    # Location quality: beta distribution (most average, some very good/bad)
    location_quality = rng.beta(2, 2, n)

    # Neighbourhood assignment (match household if possible)
    if params.n_neighbourhoods > 1:
        neighbourhoods = np.array([h.neighbourhood for h in households[:n]])
    else:
        neighbourhoods = np.zeros(n, dtype=int)

    # Retrofit time: base time scaled by size and age
    # Base time ~ mean_time ± time_var
    base_times = rng.uniform(
        params.mean_time - params.time_var,
        params.mean_time + params.time_var,
        n
    )
    # Scale by size and age factor
    age_factor = 1.0 + ages / 100.0  # Older buildings take longer
    retrofit_times = np.round(base_times * sizes * age_factor).astype(int)
    retrofit_times = np.maximum(retrofit_times, 1)  # At least 1 week

    # Retrofit cost: weekly_cost * time * size factor
    retrofit_costs = params.week_cost * retrofit_times * sizes

    # Initial condition: newer buildings better condition
    conditions = np.clip(1.0 - ages / 100.0 + rng.normal(0, 0.1, n), 0.2, 1.0)

    buildings = []
    for i in range(n):
        b = Building(
            id=i,
            size=sizes[i],
            age=ages[i],
            location_quality=location_quality[i],
            neighbourhood=neighbourhoods[i],
            retrofit_time=retrofit_times[i],
            retrofit_cost=retrofit_costs[i],
            owner_id=households[i].id if i < len(households) else i,
            condition=conditions[i],
            depreciated_value=retrofit_costs[i] * conditions[i],
        )
        buildings.append(b)
        # Link building to household
        if i < len(households):
            households[i].building_id = i

    return buildings


def create_new_building(params: Params, neighbourhood: int, rng: np.random.Generator, next_id: int) -> Building:
    """Create a newly constructed building.

    Args:
        params: Simulation parameters.
        neighbourhood: Neighbourhood index.
        rng: Random number generator.
        next_id: Next available building ID.

    Returns:
        New Building object.
    """
    # New buildings: smaller, modern, good condition
    size = rng.lognormal(0, 0.2)
    age = 0.0
    location_quality = rng.beta(3, 2)  # Slightly better locations
    condition = 1.0

    base_time = rng.uniform(
        params.mean_time - params.time_var,
        params.mean_time + params.time_var,
    )
    retrofit_time = max(1, int(np.round(base_time * size)))
    retrofit_cost = params.week_cost * retrofit_time * size

    return Building(
        id=next_id,
        size=size,
        age=age,
        location_quality=location_quality,
        neighbourhood=neighbourhood,
        retrofit_time=retrofit_time,
        retrofit_cost=retrofit_cost,
        owner_id=-1,  # No owner yet
        condition=condition,
        depreciated_value=retrofit_cost,
    )


def depreciate_buildings(buildings: List[Building], params: Params, dt: float = 1/52) -> None:
    """Apply depreciation to all buildings.

    Args:
        buildings: List of buildings.
        params: Simulation parameters.
        dt: Time step in years (default: 1 week).
    """
    if params.depreciation_rate == 0:
        return

    for b in buildings:
        if b.state == 'finished':
            # Retrofitted buildings depreciate slower
            dep_rate = params.depreciation_rate * 0.5
        else:
            dep_rate = params.depreciation_rate

        b.age += dt
        b.condition = max(0.1, b.condition - dep_rate * dt)
        b.depreciated_value = b.retrofit_cost * b.condition


"""Bank agents for v2 retrofit model."""
import numpy as np
from dataclasses import dataclass, field
from typing import List, Optional





@dataclass
class Bank:
    """A bank lending to retrofit co-ops.

    Attributes:
        id: Unique identifier.
        ltv_cap: Loan-to-value cap (fraction of project cost).
        rate_spread: Spread over base rate.
        capital: Bank's capital/reserves.
        loans: List of active loans.
        losses: Cumulative losses from defaults.
    """
    id: int
    ltv_cap: float
    rate_spread: float
    capital: float = 1_000_000.0
    loans: List[dict] = field(default_factory=list)
    losses: float = 0.0

    def can_lend(self, project_cost: float) -> bool:
        """Check if bank can lend for a project of given cost."""
        max_loan = self.ltv_cap * project_cost
        return self.capital >= max_loan

    def offer_terms(self, project_cost: float, coop_wealth: float) -> dict:
        """Generate loan terms for a project.

        Args:
            project_cost: Total project cost.
            coop_wealth: Co-op's current wealth (for risk assessment).

        Returns:
            Dict with loan terms.
        """
        max_loan = self.ltv_cap * project_cost
        # Risk premium: higher for higher LTV, lower for wealthier co-ops
        ltv = max_loan / project_cost
        risk_premium = 0.01 * (ltv / self.ltv_cap)  # Up to 1% extra
        # Wealth cushion reduces risk
        wealth_cushion = min(1.0, coop_wealth / project_cost) if project_cost > 0 else 0
        risk_premium *= (1 - 0.5 * wealth_cushion)

        rate = 0.03 + self.rate_spread + risk_premium  # Base 3% + spread + risk
        return {
            'amount': max_loan,
            'rate': rate,
            'ltv': ltv,
        }

    def make_loan(self, coop_id: int, building_id: int, terms: dict) -> None:
        """Record a new loan."""
        self.loans.append({
            'coop_id': coop_id,
            'building_id': building_id,
            'principal': terms['amount'],
            'rate': terms['rate'],
            'remaining': terms['amount'],
        })
        self.capital -= terms['amount']

    def receive_payment(self, coop_id: int, amount: float) -> float:
        """Process loan payment from co-op. Returns amount applied to principal."""
        for loan in self.loans:
            if loan['coop_id'] == coop_id and loan['remaining'] > 0:
                interest = loan['remaining'] * loan['rate'] / 52  # Weekly interest
                principal_paid = min(amount - interest, loan['remaining'])
                if principal_paid > 0:
                    loan['remaining'] -= principal_paid
                    self.capital += amount
                    return principal_paid
        return 0.0

    def check_defaults(self, coops: dict) -> List[int]:
        """Check for defaulted loans. Returns list of defaulted loan indices."""
        defaulted = []
        for i, loan in enumerate(self.loans):
            if loan['remaining'] <= 0:
                continue  # Already processed
            coop = coops[loan['coop_id']]
            # Simple default trigger: co-op account negative or severely underwater
            if coop.account < -loan['remaining'] * 0.1:
                defaulted.append(i)
        return defaulted

    def process_default(self, loan_idx: int) -> float:
        """Process a defaulted loan. Returns recovery amount."""
        loan = self.loans[loan_idx]
        # Recovery: assume 50% of collateral value
        recovery = loan['principal'] * 0.5
        self.losses += loan['remaining'] - recovery
        self.capital += recovery
        loan['remaining'] = 0
        # Mark as processed by setting a flag
        loan['defaulted'] = True
        return recovery

    def adjust_terms(self, recent_price_growth: float, recent_losses: float) -> None:
        """Adjust LTV cap and spread based on market conditions.

        Args:
            recent_price_growth: Recent price growth rate.
            recent_losses: Recent loss rate.
        """
        # Tighten after losses, loosen after price growth
        self.ltv_cap *= (1 - 0.1 * recent_losses + 0.05 * recent_price_growth)
        self.ltv_cap = np.clip(self.ltv_cap, 0.5, 0.95)

        self.rate_spread *= (1 + 0.2 * recent_losses - 0.1 * recent_price_growth)
        self.rate_spread = np.clip(self.rate_spread, 0.005, 0.05)


def create_banks(params: Params, rng: np.random.Generator) -> List[Bank]:
    """Create banks with heterogeneous LTV caps and spreads.

    Args:
        params: Simulation parameters.
        rng: Random number generator.

    Returns:
        List of Bank objects.
    """
    if params.n_banks == 0:
        return []

    banks = []
    for i in range(params.n_banks):
        # LTV cap: normal around mean
        ltv = rng.normal(params.bank_ltv_mean, params.bank_ltv_sd)
        ltv = np.clip(ltv, 0.5, 0.95)

        # Spread: normal around mean
        spread = rng.normal(params.bank_spread_mean, params.bank_spread_sd)
        spread = max(spread, 0.005)

        bank = Bank(id=i, ltv_cap=ltv, rate_spread=spread)
        banks.append(bank)

    return banks


"""Retrofit cooperative agents for v2 model."""
import numpy as np
from dataclasses import dataclass, field
from typing import List, Optional, Dict






@dataclass
class Coop:
    """A retrofit cooperative.

    Attributes:
        id: Unique identifier.
        account: Current account balance (€).
        projects: List of building IDs currently in progress.
        completed_projects: List of completed building IDs.
        total_revenue: Cumulative revenue from completed projects.
        loans: Active loans from banks.
        loan_payments: Weekly loan payment obligations.
    """
    id: int
    account: float
    projects: List[int] = field(default_factory=list)
    completed_projects: List[int] = field(default_factory=list)
    total_revenue: float = 0.0
    loans: List[dict] = field(default_factory=list)
    loan_payments: float = 0.0

    def can_afford_project(self, project_cost: float, week_cost: float,
                           params: Params, building_map: Dict[int, 'Building']) -> bool:
        """Check if co-op can afford a new project given current commitments."""
        current_committed = sum(
            building_map[p_id].retrofit_cost for p_id in self.projects
        )
        # Calculate actual weekly outflow for current projects (scaled by size)
        weekly_outflow = sum(
            building_map[p_id].retrofit_cost / building_map[p_id].retrofit_time
            for p_id in self.projects if building_map[p_id].retrofit_time > 0
        ) + self.loan_payments
        # Project annual cash flow
        annual_outflow = weekly_outflow * 52
        # Payment-to-income cap: payments shouldn't exceed 30% of revenue
        if self.total_revenue > 0:
            pti = annual_outflow / self.total_revenue
            if pti > 0.3:
                return False
        return self.account >= current_committed + project_cost

    def get_project_buildings(self, building_map: Dict[int, 'Building']) -> List['Building']:
        """Get Building objects for current projects."""
        return [building_map[p_id] for p_id in self.projects if p_id in building_map]

    def weekly_cost(self, building_map: Dict[int, 'Building']) -> float:
        """Total weekly cost for all active projects (actual cost per project)."""
        return sum(
            building_map[p_id].retrofit_cost / building_map[p_id].retrofit_time
            for p_id in self.projects if building_map[p_id].retrofit_time > 0
        )

    def request_loan(self, project_cost: float, banks: List[Bank],
                     building_map: Dict[int, 'Building'], rng: np.random.Generator) -> Optional[dict]:
        """Request loan from best bank offer.

        Args:
            project_cost: Cost of the project.
            banks: List of available banks.
            building_map: Map of building ID to Building.
            rng: Random number generator.

        Returns:
            Loan terms dict or None if no loan available.
        """
        if not banks:
            return None

        # Get offers from all banks
        offers = []
        for bank in banks:
            if bank.can_lend(project_cost):
                terms = bank.offer_terms(project_cost, self.account)
                offers.append((bank.id, terms))

        if not offers:
            return None

        # Choose best offer (lowest rate)
        best_bank_id, best_terms = min(offers, key=lambda x: x[1]['rate'])
        best_bank = banks[best_bank_id]
        best_bank.make_loan(self.id, self.projects[-1] if self.projects else -1, best_terms)

        # Add to co-op's loans
        self.loans.append({
            'bank_id': best_bank_id,
            'building_id': self.projects[-1] if self.projects else -1,
            'principal': best_terms['amount'],
            'rate': best_terms['rate'],
            'remaining': best_terms['amount'],
        })
        self.loan_payments += best_terms['amount'] * best_terms['rate'] / 52
        self.account += best_terms['amount']  # Receive loan proceeds

        return best_terms

    def make_loan_payments(self, banks: List[Bank]) -> None:
        """Make weekly loan payments to banks."""
        for loan in self.loans[:]:  # Copy to allow modification
            if loan['remaining'] <= 0:
                continue
            bank = banks[loan['bank_id']]
            weekly_payment = loan['remaining'] * loan['rate'] / 52
            principal_paid = bank.receive_payment(self.id, weekly_payment)
            loan['remaining'] -= principal_paid
            self.account -= weekly_payment

            if loan['remaining'] <= 0:
                self.loan_payments -= weekly_payment
                self.loans.remove(loan)


def create_coops(params: Params) -> List[Coop]:
    """Create all co-ops with initial endowment.

    Args:
        params: Simulation parameters.

    Returns:
        List of Coop objects.
    """
    return [Coop(id=i, account=params.E) for i in range(params.n_co_ops)]


"""Result dataclass for v2 retrofit model."""
from dataclasses import dataclass, field
from typing import Optional
import numpy as np


def _empty_array():
    return np.array([])


def _empty_2d_array():
    return np.zeros((0, 0))


@dataclass
class Result:
    """Results from a v2 retrofit simulation run.

    Attributes:
        weekly_to_do: Buildings not yet requesting retrofit per week.
        weekly_queued: Buildings waiting for co-op assignment per week.
        weekly_in_progress: Buildings currently being retrofitted per week.
        weekly_finished: Cumulative completed buildings per week.
        weekly_total_accounts: Total capital across all co-ops per week.
        weekly_with_capacity: Number of co-ops with capacity per week.
        finished: Total buildings completed at end of simulation.
        total_weeks: Number of weeks simulated.
        final_total_accounts: Total capital across all co-ops at end.
        params: Parameters used for this run.

        # Additional weekly time series
        weekly_failed_negotiations: Failed bargaining attempts per week.
        weekly_defaults: Defaults occurring per week.
        weekly_cumulative_defaults: Cumulative defaults per week.
        weekly_investor_purchases: Investor acquisitions per week.
        weekly_new_construction: New buildings started per week.
        weekly_avg_queue_wait: Average weeks in queue per week.
        weekly_max_queue_wait: Maximum weeks in queue per week.
        weekly_bank_losses: Bank losses incurred per week.
        weekly_cumulative_bank_losses: Cumulative bank losses per week.
        weekly_loan_volume: Cumulative loan volume originated per week.
        weekly_loan_payments: Total loan payments made per week.
        weekly_coop_revenue: Cumulative co-op revenue per week.
        weekly_unemployment_rate: Fraction of households unemployed per week.
        weekly_avg_retrofit_time: Average retrofit duration of completions per week.
        weekly_avg_retrofit_cost: Average retrofit cost of completions per week.

        # Per-neighbourhood weekly
        weekly_finished_per_nh: Finished buildings per neighbourhood per week.
        weekly_queue_per_nh: Queued buildings per neighbourhood per week.
        weekly_avg_price_per_nh: Average retrofit price per neighbourhood per week.

        # v2 monitors
        gini_wealth: Gini coefficient of household wealth at end.
        gini_wealth_trajectory: Gini coefficient per week.
        price_dispersion: Overall price dispersion (coefficient of variation).
        price_dispersion_within: Price dispersion within neighbourhoods.
        price_dispersion_between: Price dispersion between neighbourhoods.
        cash_buyer_share: Fraction of retrofits paid without borrowing.
        time_on_market_spread: Spread (max-min) of time-on-market across neighbourhoods.
        neighbourhood_time_on_market: Time on market per neighbourhood per week.

        # Bank/financial monitors
        bank_losses: Total bank losses.
        default_count: Number of defaults.
        total_loan_volume: Total originated.

        # Market realism monitors
        household_income_trajectories: Sample income paths.
        investor_purchases: Investor acquisitions.
        new_construction_count: New buildings added.
        population_trajectory: Household count over time.

        # Additional monitors
        weekly_cumulative_defaults: Cumulative defaults per week.
        weekly_investor_purchases: Investor purchases per week.
        weekly_new_construction: New construction per week.
        weekly_avg_queue_wait: Average queue wait time.
        weekly_max_queue_wait: Maximum queue wait time.
        weekly_bank_losses: Bank losses per week.
        weekly_cumulative_bank_losses: Cumulative bank losses per week.
        weekly_loan_volume: Loan volume per week.
        weekly_loan_payments: Loan payments per week.
        weekly_coop_revenue: Co-op revenue per week.
        weekly_unemployment_rate: Unemployment rate per week.
        weekly_avg_retrofit_time: Average retrofit time per week.
        weekly_avg_retrofit_cost: Average retrofit cost per week.
        weekly_finished_per_nh: Finished per neighbourhood per week.
        weekly_queue_per_nh: Queue per neighbourhood per week.
        weekly_avg_price_per_nh: Average price per neighbourhood per week.
    """
    # Base weekly time series (from v1)
    weekly_to_do: np.ndarray
    weekly_queued: np.ndarray
    weekly_in_progress: np.ndarray
    weekly_finished: np.ndarray
    weekly_total_accounts: np.ndarray
    weekly_with_capacity: np.ndarray
    finished: int
    total_weeks: int
    final_total_accounts: float
    params: Optional["Params"] = None  # type: ignore[name-defined]

    # Additional weekly time series
    weekly_failed_negotiations: np.ndarray = field(default_factory=_empty_array)
    weekly_defaults: np.ndarray = field(default_factory=_empty_array)
    weekly_cumulative_defaults: np.ndarray = field(default_factory=_empty_array)
    weekly_investor_purchases: np.ndarray = field(default_factory=_empty_array)
    weekly_new_construction: np.ndarray = field(default_factory=_empty_array)
    weekly_avg_queue_wait: np.ndarray = field(default_factory=_empty_array)
    weekly_max_queue_wait: np.ndarray = field(default_factory=_empty_array)
    weekly_bank_losses: np.ndarray = field(default_factory=_empty_array)
    weekly_cumulative_bank_losses: np.ndarray = field(default_factory=_empty_array)
    weekly_loan_volume: np.ndarray = field(default_factory=_empty_array)
    weekly_loan_payments: np.ndarray = field(default_factory=_empty_array)
    weekly_coop_revenue: np.ndarray = field(default_factory=_empty_array)
    weekly_unemployment_rate: np.ndarray = field(default_factory=_empty_array)
    weekly_avg_retrofit_time: np.ndarray = field(default_factory=_empty_array)
    weekly_avg_retrofit_cost: np.ndarray = field(default_factory=_empty_array)

    # Per-neighbourhood weekly
    weekly_finished_per_nh: Optional[np.ndarray] = None
    weekly_queue_per_nh: Optional[np.ndarray] = None
    weekly_avg_price_per_nh: Optional[np.ndarray] = None

    # v2 monitors
    gini_wealth: float = 0.0
    gini_wealth_trajectory: Optional[np.ndarray] = None
    weekly_income_gini: Optional[np.ndarray] = None
    price_dispersion: float = 0.0
    price_dispersion_within: float = 0.0
    price_dispersion_between: float = 0.0
    cash_buyer_share: float = 0.0
    time_on_market_spread: float = 0.0
    neighbourhood_time_on_market: Optional[np.ndarray] = None

    # Bank/financial monitors
    bank_losses: float = 0.0
    default_count: int = 0
    total_loan_volume: float = 0.0

    # Market realism monitors
    household_income_trajectories: Optional[np.ndarray] = None
    investor_purchases: int = 0
    new_construction_count: int = 0
    population_trajectory: Optional[np.ndarray] = None

    def __len__(self) -> int:
        """Return number of recorded weeks."""
        return len(self.weekly_finished)


def gini_coefficient(values: np.ndarray) -> float:
    """Calculate Gini coefficient of an array of values.

    Handles negative values by shifting to non-negative.
    """
    if len(values) == 0:
        return 0.0
    values = np.array(values)
    min_val = np.min(values)
    if min_val < 0:
        values = values - min_val
    values = np.sort(values)
    n = len(values)
    cumsum = np.cumsum(values)
    if cumsum[-1] == 0:
        return 0.0
    return (2 * np.sum((np.arange(1, n+1) * values))) / (n * cumsum[-1]) - (n + 1) / n


"""Core simulation logic for v2 retrofit model."""
import copy
import numpy as np
from typing import List, Dict, Optional










def gini_coefficient(values: np.ndarray) -> float:
    """Calculate Gini coefficient of an array of values.
    
    Handles negative values by shifting to non-negative.
    """
    if len(values) == 0:
        return 0.0
    values = np.array(values)
    # Shift to non-negative if needed
    min_val = np.min(values)
    if min_val < 0:
        values = values - min_val
    values = np.sort(values)
    n = len(values)
    cumsum = np.cumsum(values)
    if cumsum[-1] == 0:
        return 0.0
    return (2 * np.sum((np.arange(1, n+1) * values))) / (n * cumsum[-1]) - (n + 1) / n


def run_simulation(params: Params, on_week=None) -> Result:
    """Run the v2 retrofit co-op simulation.

    Args:
        params: Simulation parameters.

    Returns:
        Result object containing weekly time series and summary statistics.
    """
    rng = make_rng(params.seed)

    # Create agents - households as dict keyed by ID for stable references
    household_list = create_households(params, rng)
    households: Dict[int, Household] = {h.id: h for h in household_list}
    buildings = create_buildings(params, household_list, rng)
    coops = create_coops(params)
    banks = create_banks(params, rng)

    # Map building ID -> Building for quick lookup
    building_map = {b.id: b for b in buildings}

    # Initialize state lists
    to_do = [b.id for b in buildings if b.state == 'to_do']
    queued = []
    finished = []

    # Recording arrays
    max_weeks = params.run_time + 1
    weekly_to_do = np.zeros(max_weeks, dtype=int)
    weekly_queued = np.zeros(max_weeks, dtype=int)
    weekly_in_progress = np.zeros(max_weeks, dtype=int)
    weekly_finished = np.zeros(max_weeks, dtype=int)
    weekly_total_accounts = np.zeros(max_weeks, dtype=float)
    weekly_with_capacity = np.zeros(max_weeks, dtype=int)

    # Additional weekly time series
    weekly_failed_negotiations = np.zeros(max_weeks, dtype=int)
    weekly_defaults = np.zeros(max_weeks, dtype=int)
    weekly_cumulative_defaults = np.zeros(max_weeks, dtype=int)
    weekly_investor_purchases = np.zeros(max_weeks, dtype=int)
    weekly_new_construction = np.zeros(max_weeks, dtype=int)
    weekly_avg_queue_wait = np.zeros(max_weeks, dtype=float)
    weekly_max_queue_wait = np.zeros(max_weeks, dtype=int)
    weekly_bank_losses = np.zeros(max_weeks, dtype=float)
    weekly_cumulative_bank_losses = np.zeros(max_weeks, dtype=float)
    weekly_loan_volume = np.zeros(max_weeks, dtype=float)
    weekly_loan_payments = np.zeros(max_weeks, dtype=float)
    weekly_coop_revenue = np.zeros(max_weeks, dtype=float)
    weekly_unemployment_rate = np.zeros(max_weeks, dtype=float)
    weekly_avg_retrofit_time = np.zeros(max_weeks, dtype=float)
    weekly_avg_retrofit_cost = np.zeros(max_weeks, dtype=float)

    # Per-neighbourhood weekly
    if params.n_neighbourhoods > 1:
        weekly_finished_per_nh = np.zeros((params.n_neighbourhoods, max_weeks), dtype=int)
        weekly_queue_per_nh = np.zeros((params.n_neighbourhoods, max_weeks), dtype=int)
        weekly_avg_price_per_nh = np.zeros((params.n_neighbourhoods, max_weeks), dtype=float)
    else:
        weekly_finished_per_nh = None
        weekly_queue_per_nh = None
        weekly_avg_price_per_nh = None

    # v2 monitors
    weekly_gini = np.zeros(max_weeks, dtype=float)
    weekly_income_gini = np.zeros(max_weeks, dtype=float)
    if params.n_neighbourhoods > 1:
        neighbourhood_time_on_market = np.zeros((params.n_neighbourhoods, max_weeks), dtype=float)
    else:
        neighbourhood_time_on_market = None

    # Time-on-market tracking per building
    building_entry_week = {b.id: -1 for b in buildings}

    # Financial tracking
    total_loan_volume = 0.0
    default_count = 0
    cash_purchases = 0
    total_purchases = 0
    investor_purchases = 0
    new_construction_count = 0
    total_finished_count = 0  # Total buildings that have ever completed retrofit

    # Income trajectories (sample subset for memory)
    income_sample_size = min(100, params.n_households)
    household_income_trajectories = np.zeros((income_sample_size, max_weeks), dtype=float)

    # Population trajectory
    population_trajectory = np.zeros(max_weeks, dtype=int)

    # Next building ID for new construction
    next_building_id = params.n
    next_household_id = params.n_households

    t = 0
    while t < params.run_time:
        if on_week is not None:
            on_week(t, buildings, households, coops)  # read-only hook: must not draw from rng
        # Record state at start of week
        weekly_to_do[t] = len(to_do)
        weekly_queued[t] = len(queued)
        weekly_in_progress[t] = sum(len(c.projects) for c in coops)
        weekly_finished[t] = len(finished)
        weekly_total_accounts[t] = sum(c.account for c in coops)

        # Calculate Gini of household wealth
        wealths = np.array([h.wealth for h in households.values()])
        weekly_gini[t] = gini_coefficient(wealths)

        # Calculate Gini of household income (sample)
        n_households = len(households)
        if n_households > 0:
            sample_size = min(income_sample_size, n_households)
            household_ids = list(households.keys())
            sample_idx = rng.choice(len(household_ids), sample_size, replace=False)
            sample_household_ids = [household_ids[i] for i in sample_idx]
            incomes_sample = np.array([households[h_id].income for h_id in sample_household_ids])
            weekly_income_gini[t] = gini_coefficient(incomes_sample)

            # Record income trajectories
            for idx, h_id in enumerate(sample_household_ids):
                household_income_trajectories[idx, t] = households[h_id].income

            # Unemployment rate
            unemployed = sum(1 for h in households.values() if h.unemployed)
            weekly_unemployment_rate[t] = unemployed / n_households

        # Population
        population_trajectory[t] = len(households)

        # Queue wait times
        if len(queued) > 0:
            wait_times = [t - building_entry_week[b_id] for b_id in queued]
            weekly_avg_queue_wait[t] = np.mean(wait_times)
            weekly_max_queue_wait[t] = max(wait_times)

        # Co-op metrics
        weekly_coop_revenue[t] = sum(c.total_revenue for c in coops)

        # Per-neighbourhood queue
        if params.n_neighbourhoods > 1:
            for nh in range(params.n_neighbourhoods):
                nh_queue = [b_id for b_id in queued if building_map[b_id].neighbourhood == nh]
                weekly_queue_per_nh[nh, t] = len(nh_queue)

        # Bank metrics
        weekly_bank_losses[t] = sum(b.losses for b in banks)
        weekly_cumulative_bank_losses[t] = sum(b.losses for b in banks)

        # 1. Households decide to request retrofits
        if to_do:
            requesting = []
            for b_id in to_do:
                building = building_map[b_id]
                owner = households.get(building.owner_id)
                if owner and owner.wants_retrofit(rng):
                    requesting.append(b_id)

            for b_id in requesting:
                building = building_map[b_id]
                building.state = 'queued'
                building_entry_week[b_id] = t
                queued.append(b_id)

            to_do = [b_id for b_id in to_do if b_id not in requesting]

        # 2. Assign queued buildings to co-ops (with bargaining)
        with_capacity_count = 0
        for b_id in queued.copy():
            building = building_map[b_id]
            estimate = building.retrofit_cost

            # Determine eligible co-ops
            if params.search_length > 0 and params.search_length < params.n_co_ops:
                search_pool = rng.choice(params.n_co_ops, size=params.search_length, replace=False)
            else:
                search_pool = list(range(params.n_co_ops))

            with_capacity = []
            for c_id in search_pool:
                coop = coops[c_id]
                current_committed = sum(building_map[p_id].retrofit_cost for p_id in coop.projects)
                if coop.account >= current_committed + estimate:
                    with_capacity.append(c_id)

            if not with_capacity:
                break

            with_capacity_count = len(with_capacity)
            c_id = rng.choice(with_capacity)
            coop = coops[c_id]
            coop.projects.append(queued.pop(0))
            building = building_map[coop.projects[-1]]
            building.state = 'in_progress'
            building.assigned_coop = c_id
            building.weeks_remaining = building.retrofit_time

            # Bargaining: household bids below asking price
            owner = households.get(building.owner_id)
            if owner and params.enable_bargaining:
                bid = owner.bid_price(building.retrofit_cost, params, rng)
                reservation = building.retrofit_cost * params.seller_reservation_pct
                if bid < reservation:
                    # Negotiation failed - building returns to queued
                    coop.projects.remove(building.id)
                    building.state = 'queued'
                    building.assigned_coop = None
                    queued.append(building.id)
                    weekly_failed_negotiations[t] += 1
                    continue

                building.negotiated_price = bid
            else:
                building.negotiated_price = building.retrofit_cost

            # Co-op may request loan for the project
            total_purchases += 1
            if params.n_banks > 0 and rng.random() < 0.5:
                loan_terms = coop.request_loan(building.negotiated_price, banks, building_map, rng)
                if loan_terms:
                    total_loan_volume += loan_terms['amount']
                    building.financed = True
                else:
                    building.financed = False
                    cash_purchases += 1
            else:
                building.financed = False
                cash_purchases += 1

        weekly_with_capacity[t] = with_capacity_count

        # 3. Co-ops do work on projects and make loan payments
        for coop in coops:
            if params.n_banks > 0:
                coop.make_loan_payments(banks)

            for p_id in copy.deepcopy(coop.projects):
                building = building_map[p_id]
                # Calculate actual weekly cost for this building
                weekly_cost = building.retrofit_cost / building.retrofit_time if building.retrofit_time > 0 else 0
                if building.weeks_remaining <= 0:
                    # Project complete
                    coop.projects.remove(p_id)
                    coop.completed_projects.append(p_id)
                    building.state = 'finished'
                    building.assigned_coop = None
                    finished.append(p_id)
                    total_finished_count += 1

                    # Record average retrofit time/cost for this week
                    weekly_avg_retrofit_time[t] = building.retrofit_time
                    weekly_avg_retrofit_cost[t] = building.retrofit_cost

                    # Per-neighbourhood finished
                    if params.n_neighbourhoods > 1:
                        nh = building.neighbourhood
                        weekly_finished_per_nh[nh, t] += 1
                        # Track prices for average
                        if weekly_avg_price_per_nh[nh, t] == 0:
                            weekly_avg_price_per_nh[nh, t] = building.retrofit_cost
                        else:
                            weekly_avg_price_per_nh[nh, t] = (weekly_avg_price_per_nh[nh, t] + building.retrofit_cost) / 2

                    # Co-op receives payment with surplus
                    price = getattr(building, 'negotiated_price', building.retrofit_cost)
                    revenue = (1 + params.surplus) * price
                    coop.account += revenue
                    coop.total_revenue += revenue

                    # Household pays (wealth decreases by negotiated price)
                    owner = households.get(building.owner_id)
                    if owner:
                        owner.wealth = max(0, owner.wealth - price)
                else:
                    # Work in progress
                    if coop.account >= weekly_cost:
                        building.weeks_remaining -= 1
                        coop.account -= weekly_cost

        # 4. Bank default processing
        if params.enable_default and params.n_banks > 0:
            for bank in banks:
                defaulted = bank.check_defaults({c.id: c for c in coops})
                for loan_idx in defaulted:
                    bank.process_default(loan_idx)
                    default_count += 1

        # Record weekly financial metrics
        weekly_defaults[t] = default_count
        weekly_cumulative_defaults[t] = default_count
        weekly_bank_losses[t] = sum(b.losses for b in banks)
        weekly_cumulative_bank_losses[t] = sum(b.losses for b in banks)
        weekly_loan_volume[t] = total_loan_volume
        weekly_loan_payments[t] = sum(c.loan_payments for c in coops)

        # 5. Income process update
        if params.income_ar1_rho > 0:
            for h in households.values():
                h.update_income(params, rng)

        # 6. Investor market activity
        if params.enable_investors:
            # Track which buildings have been purchased this week to avoid double-sales
            purchased_this_week = set()
            for h in list(households.values()):
                if h.is_investor:
                    # Check finished buildings for investment opportunities
                    for b_id in finished:
                        if b_id in purchased_this_week:
                            continue  # Already purchased this week
                        building = building_map[b_id]
                        if building.owner_id == h.id:
                            continue  # Already own
                        if h.wants_investment(building, params, rng):
                            # Investor purchases building
                            investor_purchases += 1
                            purchased_this_week.add(b_id)
                            # Transfer ownership
                            old_owner = households.get(building.owner_id)
                            if old_owner:
                                old_owner.building_id = None
                            building.owner_id = h.id
                            h.building_id = b_id
                            # Pay price
                            h.wealth -= building.retrofit_cost
                            # Remove from finished list - no longer available for re-purchase
                            if b_id in finished:
                                finished.remove(b_id)

            # Record weekly investor purchases
            weekly_investor_purchases[t] = investor_purchases

        # 7. Demographics: births, deaths, household formation
        if params.enable_demographics:
            # Deaths
            dead_household_ids = []
            for h_id, h in list(households.items()):
                death_prob = params.death_rate / 52.0  # Weekly probability
                if h.age > 65:
                    death_prob *= 3  # Higher for elderly
                if rng.random() < death_prob:
                    dead_household_ids.append(h_id)
                    # Household dies - building becomes available
                    if h.building_id is not None:
                        building = building_map[h.building_id]
                        building.owner_id = -1
                        building.state = 'to_do'
                        if building.id not in to_do:
                            to_do.append(building.id)

            for h_id in dead_household_ids:
                del households[h_id]

            # Births / new household formation
            births = rng.poisson(len(households) * params.birth_rate / 52.0)
            for _ in range(births):
                # New household with random attributes
                new_id = next_household_id
                next_household_id += 1
                sigma = np.sqrt(np.log(1 + params.income_cv**2))
                mu = np.log(params.income_mean) - sigma**2 / 2
                income = rng.lognormal(mu, sigma)
                wealth = params.income_mean / 10.0 * (1 - rng.random())**(-1.0 / params.wealth_pareto_alpha)
                aspiration = np.clip(rng.normal(params.aspiration_mean, params.aspiration_sd), 0, 100)
                affordability = np.clip(rng.normal(0.33, 0.1), 0.05, 0.6)
                taste_weights = rng.dirichlet([2.0, 2.0, 2.0])
                taste_shock = rng.normal(0, 0.5)
                neighbourhood = rng.integers(0, params.n_neighbourhoods)
                age = 25
                is_investor = rng.random() < 0.15
                hurdle_rate = np.clip(rng.normal(params.investor_hurdle_mean, params.investor_hurdle_sd), 0.02, 0.15)
                expectations_type = 'extrapolator' if rng.random() < params.extrapolator_share else 'fundamentalist'

                new_h = Household(
                    id=new_id,
                    income=income,
                    wealth=wealth,
                    aspiration=aspiration,
                    affordability=affordability,
                    taste_weights=taste_weights,
                    taste_shock=taste_shock,
                    neighbourhood=neighbourhood,
                    age=age,
                    is_investor=is_investor,
                    hurdle_rate=hurdle_rate,
                    expectations_type=expectations_type,
                )
                new_h.income_history.append(income)
                households[new_id] = new_h

        # 8. Building depreciation
        if params.depreciation_rate > 0:
            depreciate_buildings(list(building_map.values()), params, dt=1/52.0)

        # 9. New construction
        if params.enable_construction:
            # Check if price > build cost in any neighbourhood
            if params.n_neighbourhoods > 1:
                for nh in range(params.n_neighbourhoods):
                    nh_finished = [b_id for b_id in finished
                                  if building_map[b_id].neighbourhood == nh]
                    if len(nh_finished) > 10:
                        prices = [building_map[b_id].retrofit_cost for b_id in nh_finished]
                        avg_price = np.mean(prices)
                        if avg_price > params.build_cost * 1.2:  # 20% premium triggers construction
                            if rng.random() < 0.1:  # 10% chance per week
                                new_b = create_new_building(params, nh, rng, next_building_id)
                                next_building_id += 1
                                buildings.append(new_b)
                                building_map[new_b.id] = new_b
                                to_do.append(new_b.id)
                                new_construction_count += 1
            else:
                if len(finished) > 10:
                    prices = [building_map[b_id].retrofit_cost for b_id in finished]
                    avg_price = np.mean(prices)
                    if avg_price > params.build_cost * 1.2:
                        if rng.random() < 0.1:
                            new_b = create_new_building(params, 0, rng, next_building_id)
                            next_building_id += 1
                            buildings.append(new_b)
                            building_map[new_b.id] = new_b
                            to_do.append(new_b.id)
                            new_construction_count += 1

        # Record weekly new construction
        weekly_new_construction[t] = new_construction_count

        t += 1

        if len(finished) == params.n and not params.enable_construction:
            break

    # Record final week
    weekly_to_do[t] = len(to_do)
    weekly_queued[t] = len(queued)
    weekly_in_progress[t] = sum(len(c.projects) for c in coops)
    weekly_finished[t] = len(finished)
    weekly_total_accounts[t] = sum(c.account for c in coops)
    weekly_with_capacity[t] = 0
    wealths = np.array([h.wealth for h in households.values()])
    weekly_gini[t] = gini_coefficient(wealths)
    population_trajectory[t] = len(households)

    actual_weeks = t + 1

    # Calculate final monitors
    gini_wealth = weekly_gini[actual_weeks - 1]

    # Price dispersion
    finished_costs = np.array([building_map[b_id].retrofit_cost for b_id in finished])
    price_dispersion = np.std(finished_costs) / np.mean(finished_costs) if len(finished_costs) > 0 else 0.0

    # Price dispersion within/between neighbourhoods
    if params.n_neighbourhoods > 1 and len(finished_costs) > 0:
        within_dispersions = []
        between_means = []
        for nh in range(params.n_neighbourhoods):
            nh_costs = [building_map[b_id].retrofit_cost for b_id in finished
                        if building_map[b_id].neighbourhood == nh]
            if len(nh_costs) > 1:
                within_dispersions.append(np.std(nh_costs) / np.mean(nh_costs))
            if len(nh_costs) > 0:
                between_means.append(np.mean(nh_costs))
        price_dispersion_within = np.mean(within_dispersions) if within_dispersions else 0.0
        price_dispersion_between = np.std(between_means) / np.mean(between_means) if len(between_means) > 1 else 0.0
    else:
        price_dispersion_within = 0.0
        price_dispersion_between = 0.0

    # Cash buyer share
    cash_buyer_share = cash_purchases / total_purchases if total_purchases > 0 else 1.0

    # Bank losses
    bank_losses = sum(b.losses for b in banks)

    # Time on market spread
    if neighbourhood_time_on_market is not None:
        nh_times = []
        for nh in range(params.n_neighbourhoods):
            nh_finished = [b_id for b_id in finished
                          if building_map[b_id].neighbourhood == nh]
            if nh_finished:
                times = [actual_weeks - building_entry_week[b_id] for b_id in nh_finished]
                nh_times.append(np.mean(times))
            else:
                nh_times.append(0)
        time_on_market_spread = max(nh_times) - min(nh_times) if nh_times else 0.0
    else:
        time_on_market_spread = 0.0

    # Trim arrays
    return Result(
        weekly_to_do=weekly_to_do[:actual_weeks],
        weekly_queued=weekly_queued[:actual_weeks],
        weekly_in_progress=weekly_in_progress[:actual_weeks],
        weekly_finished=weekly_finished[:actual_weeks],
        weekly_total_accounts=weekly_total_accounts[:actual_weeks],
        weekly_with_capacity=weekly_with_capacity[:actual_weeks],
        finished=total_finished_count,
        total_weeks=actual_weeks,
        final_total_accounts=sum(c.account for c in coops),
        params=params,
        gini_wealth=gini_wealth,
        gini_wealth_trajectory=weekly_gini[:actual_weeks],
        weekly_income_gini=weekly_income_gini[:actual_weeks],
        price_dispersion=price_dispersion,
        price_dispersion_within=price_dispersion_within,
        price_dispersion_between=price_dispersion_between,
        cash_buyer_share=cash_buyer_share,
        time_on_market_spread=time_on_market_spread,
        neighbourhood_time_on_market=neighbourhood_time_on_market[:, :actual_weeks] if neighbourhood_time_on_market is not None else None,
        bank_losses=bank_losses,
        default_count=default_count,
        total_loan_volume=total_loan_volume,
        household_income_trajectories=household_income_trajectories[:, :actual_weeks],
        investor_purchases=investor_purchases,
        new_construction_count=new_construction_count,
        population_trajectory=population_trajectory[:actual_weeks],
        # Additional weekly time series
        weekly_failed_negotiations=weekly_failed_negotiations[:actual_weeks],
        weekly_defaults=weekly_defaults[:actual_weeks],
        weekly_cumulative_defaults=weekly_cumulative_defaults[:actual_weeks],
        weekly_investor_purchases=weekly_investor_purchases[:actual_weeks],
        weekly_new_construction=weekly_new_construction[:actual_weeks],
        weekly_avg_queue_wait=weekly_avg_queue_wait[:actual_weeks],
        weekly_max_queue_wait=weekly_max_queue_wait[:actual_weeks],
        weekly_bank_losses=weekly_bank_losses[:actual_weeks],
        weekly_cumulative_bank_losses=weekly_cumulative_bank_losses[:actual_weeks],
        weekly_loan_volume=weekly_loan_volume[:actual_weeks],
        weekly_loan_payments=weekly_loan_payments[:actual_weeks],
        weekly_coop_revenue=weekly_coop_revenue[:actual_weeks],
        weekly_unemployment_rate=weekly_unemployment_rate[:actual_weeks],
        weekly_avg_retrofit_time=weekly_avg_retrofit_time[:actual_weeks],
        weekly_avg_retrofit_cost=weekly_avg_retrofit_cost[:actual_weeks],
        # Per-neighbourhood weekly
        weekly_finished_per_nh=weekly_finished_per_nh[:, :actual_weeks] if weekly_finished_per_nh is not None else None,
        weekly_queue_per_nh=weekly_queue_per_nh[:, :actual_weeks] if weekly_queue_per_nh is not None else None,
        weekly_avg_price_per_nh=weekly_avg_price_per_nh[:, :actual_weeks] if weekly_avg_price_per_nh is not None else None,
    )
