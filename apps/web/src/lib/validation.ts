import { z } from 'zod';

// Schema validation must work with the app's strict CSP, including Firefox.
z.config({ jitless: true });
