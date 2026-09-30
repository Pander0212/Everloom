Measured over 30 turns with the mock model (apps/server/test/cost.test.ts).

| Call | cheap | balanced | max |
|---|---:|---:|---:|
| chronicler | 0.03 | 0.03 | 0.10 |
| consolidation | 0.00 | 0.10 | 0.23 |
| memory embeddings | 0.00 | 0.50 | 1.00 |
| off-screen life | 0.00 | 0.33 | 1.00 |
| pre-read | 0.00 | 0.00 | 1.00 |
| recall query embedding | 0.00 | 0.97 | 0.97 |
| reply | 1.00 | 1.00 | 1.00 |
| storyline seeding | 0.00 | 0.07 | 0.07 |
| tracker | 1.00 | 1.00 | 1.00 |
| **LLM calls / turn** | **2.03** | **2.53** | **4.40** |
| embedding calls / turn | 0.00 | 1.47 | 1.97 |
