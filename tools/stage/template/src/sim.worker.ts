// The model runs here, never on the main thread (technology §3).
import model from '../../sim-code/model.ts';
import { serveModel } from './stage/sim.ts';

serveModel(model);
