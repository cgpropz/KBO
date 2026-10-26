// Loads the published NBA pair file. No new math — the slip builder reads
// the same dataset (nba_correlations / correlations_nba.json).

import { fetchApiDataset } from './apiData.js'
import { presentCorrelationDoc } from './slipCorrelations.js'
import {
  NBA_CORRELATION_DATASET,
  NBA_CORRELATION_STATIC,
  NBA_MIN_SHARED,
} from './correlatedProps.js'

export async function loadNbaCorrelations() {
  try {
    const snapshot = await fetchApiDataset(NBA_CORRELATION_DATASET, {
      devStaticPath: NBA_CORRELATION_STATIC,
    })
    return {
      doc: presentCorrelationDoc(snapshot?.data, NBA_MIN_SHARED),
      preview: snapshot?.preview === true,
      lockedCount: Number(snapshot?.lockedCount) || 0,
    }
  } catch {
    return {
      doc: presentCorrelationDoc(null, NBA_MIN_SHARED),
      preview: false,
      lockedCount: 0,
    }
  }
}
