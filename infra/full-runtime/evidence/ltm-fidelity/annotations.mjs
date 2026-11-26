const dominance = (start, end, partition, ...loops) => ({kind:'dominance',start,end,partition,loops});
const point = (variable, at, value, decimals, timeDecimals) => ({kind:'value',variable,at,value,decimals,timeDecimals});
const minimum = (variable, at, value, decimals) => ({kind:'min',variable,at,value,decimals});
const interpretation = {kind:'mechanism'};

// Each anchor refers to the named surface. Expected labels freeze the reviewed
// interpretation of the text; the checker computes its verdict independently.
export const annotations = {
  armsRace:{
    narrative:[
      ['supported','From 7.625 through the end of the simulation at time 50',dominance(7.625,50,0,'P0/U1')],
      ['unverified','preventing rapid shifts',interpretation],
    ],
    final:[
      ['contradicted','minimum of approximately 6.62 at time 5.125',minimum('our_weapons',5.125,6.62,2)],
      ['supported','ending the simulation at approximately 36.76',point('our_weapons',50,36.76,2)],
    ],
  },
  bassDiffusion:{
    narrative:[
      ['supported','from 0.0625 to 9.625',dominance(0.0625,9.625,0,'P0/R1')],
      ['supported','from 9.6875 to 15',dominance(9.6875,15,0,'P0/B1')],
    ],
    final:[
      ['contradicted','999,915 at $t=4.56$',point('potential_adopters',4.56,999915,0,2)],
      ['supported','reaching a value of approximately 215',point('potential_adopters',15,215,0)],
    ],
  },
  inventoryWorkforce:{
    narrative:[
      ['contradicted','From the start of the simulation until time 60',dominance(0,60,0,'P0/B1')],
      ['supported','Between time 1.0625 and 1.9375',dominance(1.0625,1.9375,1,'P1/B3')],
    ],
    final:[
      ['contradicted','minimum of approximately 87.95 (around time 6.125)',minimum('inventory',6.125,87.95,2)],
      ['contradicted','Initial Phase (Time 0 to 60)',dominance(0,60,0,'P0/B1')],
    ],
  },
  predatorPrey:{
    narrative:[
      ['supported','from time 2 to 2',dominance(2,2,0,'P0/R1','P0/R2')],
    ],
    final:[
      ['contradicted','peaks exceeding 100,000 (e.g., at time 14', {kind:'above',variable:'hares',at:14,value:100000}],
      ['unverified','indicating a stable limit cycle',interpretation],
    ],
  },
  marketGrowth:{
    narrative:[
      ['supported','period from time 5 to 5',dominance(5,5,0,'P0/B10')],
      ['supported','Between time 10 and 10',dominance(10,10,0,'P0/R6','P0/R7')],
    ],
    final:[
      ['unverified','forcing the system toward a steady state',interpretation],
      ['supported','rising from 1 to a local peak',point('backlog',0,1)],
    ],
  },
  maibab:{
    narrative:[
      ['contradicted','From 1811 to 1817',dominance(1811,1817,0,'P0/B1','P0/B2','P0/B6')],
      ['supported','Between 1818 and 1830',dominance(1818,1830,0,'P0/B6')],
      ['contradicted','from 1947 to 2300',dominance(1947,2300,0,'P0/B6')],
    ],
    final:[
      ['contradicted','peaking near 10,399 around 1930',point('deer_population',1930,10399,0)],
      ['contradicted','Long-Term Stabilization (1947–2300)',dominance(1947,2300,0,'P0/B6')],
    ],
  },
  'maibab-control':{
    narrative:[
      ['supported','1810.125 and 1810.25',dominance(1810.125,1810.25,0,'P0/B1','P0/B6')],
      ['supported','1810.375 to 1812',dominance(1810.375,1812,0,'P0/B1','P0/B2','P0/B6')],
    ],
    final:[
      ['supported','Final Value (at t=1812): 4332.21',point('deer_population',1812,4332.21,2)],
    ],
  },
  'maibab-perturbed':{
    narrative:[
      ['supported','between 1810.125 and 1812',dominance(1810.125,1812,0,'P0/B3','P0/B6')],
    ],
    final:[
      ['supported','approximately 2838 by the end',point('deer_population',1812,2838,0)],
      ['unverified','outflows (predation and resource-driven mortality)',interpretation],
    ],
  },
};
