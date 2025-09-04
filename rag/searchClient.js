// Azure AI Search client factory (modular)
// Env vars required:
//  - AZURE_SEARCH_ENDPOINT (e.g., https://<service>.search.windows.net)
//  - AZURE_SEARCH_API_KEY (admin/query key)
//  - AZURE_SEARCH_INDEX (index name)
import { SearchClient, AzureKeyCredential } from '@azure/search-documents'

export function createSearchClient() {
  const endpoint = process.env.AZURE_SEARCH_ENDPOINT
  const apiKey = process.env.AZURE_SEARCH_API_KEY
  const indexName = process.env.AZURE_SEARCH_INDEX
  if (!endpoint || !apiKey || !indexName) {
    throw new Error('Missing Azure Search config: AZURE_SEARCH_ENDPOINT, AZURE_SEARCH_API_KEY, AZURE_SEARCH_INDEX')
  }
  const client = new SearchClient(endpoint, indexName, new AzureKeyCredential(apiKey))
  return client
}

export async function searchTopN(query, options = {}) {
  const client = createSearchClient()
  const top = options.top ?? 5
  const select = options.select
  const filter = options.filter
  const vectors = options.vectors // optional for hybrid/vector search
  const searchFields = options.searchFields
  const includeTotalCount = options.includeTotalCount ?? false

  const params = {
    top,
    select,
    filter,
    vectors,
    searchFields,
    includeTotalCount
  }
  const results = []
  const iter = await client.search(query || '*', params)
  for await (const res of iter.results) {
    results.push({ score: res.score, document: res.document })
  }
  return results
}
