<script lang="ts">
  import { getContext, tick } from "svelte";

  import BaseWindow from "$lib/components/windows/BaseWindow.svelte";
  import Icon from "$lib/components/utils/Icon.svelte";
  import NotebookDestinationDialog from "$lib/components/notebooks/NotebookDestinationDialog.svelte";
  import { showToast } from "$lib/components/utils/ToastHost.svelte";
  import { selectedDocumentIds } from "$lib/utils/documentSelection";
  import { attachChunkToNotebookDestination } from "$lib/utils/notebookState";
  import { showWindow } from "$lib/utils/workspaceState";
  import { isBrowserViewableSourceType } from "$lib/utils/documentReferences";
  import type { AppState } from "$lib/state.svelte";
  import type { NotebookPageContentRequest } from "$lib/requestTypes";
  import type { UserSettings } from "$lib/server/database/schema";
  import { formatPositionLabel } from "$lib/utils/positionLabel";
  import type { WindowInstanceProps } from "./index";

  type RetrievalMode = "semantic" | "bm25" | "hybrid";
  type SearchMatch = {
    chunkId: string;
    documentId: string;
    sourceTitle: string;
    sourceType: "PDF" | "DOCX" | "PPTX" | "CSV" | "XLSX" | "TXT" | "MD";
    pageIndex: number;
    chunkIndex: number;
    content: string;
  };
  type SearchResults = Record<RetrievalMode, SearchMatch[]>;

  let {
    id,
    title,
    closable = false,
    height = null,
    collapsed = false,
    onToggleCollapse = () => {},
    onClose = () => {},
  }: WindowInstanceProps = $props();

  const appState = getContext<AppState>("appState");
  const retrievalModes: { id: RetrievalMode; label: string }[] = [
    { id: "semantic", label: "Semantic" },
    { id: "bm25", label: "BM25" },
    { id: "hybrid", label: "Hybrid" },
  ];

  let query = $state(appState.lastQuery);
  let retrievalMode = $state<RetrievalMode>("hybrid");
  let ragTopK = $state(appState.ragTopK);
  let results = $state<SearchResults>({
    semantic: [],
    bm25: [],
    hybrid: [],
  });
  let loading = $state(false);
  let error = $state("");
  const activeResults = $derived(results[retrievalMode] ?? []);

  let chunkDestinationOpen = $state(false);
  let pendingResult = $state<SearchMatch | null>(null);

  function pdfHref(result: SearchMatch) {
    return `/document-files/${encodeURIComponent(result.documentId)}#page=${result.pageIndex + 1}`;
  }

  function saveResultChunk(result: SearchMatch) {
    pendingResult = result;
    chunkDestinationOpen = true;
  }

  function closeChunkDestination() {
    chunkDestinationOpen = false;
    pendingResult = null;
  }

  async function saveResultChunkToDestination(destination: {
    notebookId: string;
    notebookTitle: string;
    pageId: string;
    pageTitle: string;
  }) {
    const result = pendingResult;
    if (!result) throw new Error("Choose a result to save.");

    const outcome = await attachChunkToNotebookDestination(
      appState,
      destination,
      result.chunkId,
    );

    const page = appState.activePage;
    if (page && page.id === destination.pageId) {
      const separator = page.content.trim() ? "\n\n" : "";
      const nextContent = `${page.content}${separator}${result.content}`;
      const updateRes = await fetch(
        `/notebooks/${destination.notebookId}/pages/${destination.pageId}/update`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: nextContent,
          } satisfies NotebookPageContentRequest),
        },
      );
      if (!updateRes.ok) {
        throw new Error("The chunk was attached, but the text could not be added to the page.");
      }
      appState.notebooks = (await updateRes.json()).notebooks ?? appState.notebooks;
    }

    showWindow("notebook-window");
    await tick();
    window.dispatchEvent(new CustomEvent("dk:notebooks-updated"));
    window.dispatchEvent(new CustomEvent("notebook-sources:refresh"));
    const label = `${destination.notebookTitle} → ${destination.pageTitle}`;
    showToast(
      outcome.duplicate
        ? `Text added and chunk already exists in Loaded Sources for ${label}`
        : `Text and chunk added to ${label}`,
    );
    closeChunkDestination();
  }

  function handleRetrievalModeChange(mode: RetrievalMode) {
    if (retrievalMode === mode) return;
    retrievalMode = mode;
  }

  function handleChunkCountChange() {
    ragTopK = Math.max(1, Math.floor(ragTopK || 1));
  }

  async function runSearch() {
    const searchQuery = query.trim();
    if (!searchQuery) {
      results = { semantic: [], bm25: [], hybrid: [] };
      return;
    }

    loading = true;
    error = "";
    appState.lastQuery = searchQuery;

    const params = new URLSearchParams({
      query: searchQuery,
      topK: String(Math.max(1, Math.floor(ragTopK || appState.ragTopK || 1))),
    });

    for (const documentId of $selectedDocumentIds) {
      params.append("documentIds", documentId);
    }

    try {
      const resp = await fetch(`/search?${params}`);
      if (!resp.ok) throw new Error(await resp.text());

      const data = (await resp.json()) as Partial<SearchResults>;
      results = {
        semantic: data.semantic ?? [],
        bm25: data.bm25 ?? [],
        hybrid: data.hybrid ?? [],
      };
    } catch (searchError) {
      error = searchError instanceof Error ? searchError.message : "Search failed";
      results = { semantic: [], bm25: [], hybrid: [] };
    } finally {
      loading = false;
    }
  }

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    await runSearch();
  }

</script>

<BaseWindow
  {id}
  {title}
  {closable}
  {height}
  {collapsed}
  {onToggleCollapse}
  {onClose}
  contentLabel="Search context window"
  >
  <div class="search-context-window">
    <form class="search-bar" onsubmit={handleSubmit}>
      <input
        class="input"
        type="text"
        placeholder="Enter search text..."
        bind:value={query}
        aria-label="Search text"
      />

      <input
        class="input chunk-count"
        type="number"
        min="1"
        step="1"
        bind:value={ragTopK}
        aria-label="Number of chunks"
        onchange={handleChunkCountChange}
      />

      <button class="btn search-button" type="submit" disabled={loading}>
        <Icon name="search" size={16} />
        <span>{loading ? "Searching..." : "Search"}</span>
      </button>
    </form>

    <div class="retrieval-toggle" role="group" aria-label="Search method">
      {#each retrievalModes as mode}
        <button
          class:active={retrievalMode === mode.id}
          type="button"
          aria-pressed={retrievalMode === mode.id}
          onclick={() => handleRetrievalModeChange(mode.id)}
        >
          {mode.label}
        </button>
      {/each}
    </div>

    {#if error}
      <div class="search-message error">{error}</div>
    {/if}

    <div class="results-list" aria-live="polite">
      {#if loading}
        <p class="search-message">Searching...</p>
      {:else if activeResults.length}
        {#each activeResults as result, index (result.chunkId)}
          <div class="result-card">
            <div class="result-meta">
              <span class="result-rank">#{index + 1}</span>
              <span class="result-title">{result.sourceTitle}</span>
              {#if formatPositionLabel(result.sourceType, result.pageIndex, result.chunkIndex)}
                <span>{formatPositionLabel(result.sourceType, result.pageIndex, result.chunkIndex)}</span>
              {/if}
            </div>
            <p class="result-content">{result.content}</p>
            <div class="result-actions">
              {#if isBrowserViewableSourceType(result.sourceType)}
                <a
                  class="btn btn-sm"
                  href={pdfHref(result)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open in browser
                </a>
              {/if}
              <button
                class="btn btn-sm"
                type="button"
                title="Send this result to a notebook"
                onclick={() => saveResultChunk(result)}
              >
                Send to notebook
              </button>
            </div>
          </div>
        {/each}
      {:else}
        <p class="search-message">No context</p>
      {/if}
    </div>

  </div>

  <NotebookDestinationDialog
    open={chunkDestinationOpen}
    kindLabel="Save Chunk"
    itemTitle={pendingResult?.sourceTitle ?? "Selected chunk"}
    actionLabel="Save Chunk"
    ariaLabel="Save search result destination"
    onClose={closeChunkDestination}
    onSave={saveResultChunkToDestination}
  />

</BaseWindow>

<style>
  .retrieval-toggle {
    display: grid;
    width: min(260px, 100%);
    min-width: 0;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: hsl(var(--h) var(--sat) calc(var(--l-bg) + 2%));
  }

  .retrieval-toggle button {
    min-width: 0;
    min-height: 28px;
    padding: 4px 6px;
    border: 0;
    border-left: 1px solid var(--border);
    border-radius: 0;
    background: transparent;
    color: var(--muted);
    font-size: 11px;
    font-weight: 650;
  }

  .retrieval-toggle button:first-child {
    border-left: 0;
  }

  .retrieval-toggle button.active {
    background: color-mix(in oklab, var(--accent) 18%, transparent);
    color: var(--text);
  }

  .results-list {
    display: grid;
    min-height: 0;
    gap: 8px;
  }

  .result-card {
    display: flex;
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    flex-direction: column;
    overflow: hidden;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: hsl(var(--h) var(--sat) calc(var(--l-panel) + 3%));
    gap: 6px;
  }

  .result-meta {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    align-items: center;
    color: var(--muted);
    font-size: 11px;
    gap: 6px;
  }

  .result-rank {
    padding: 1px 5px;
    border-radius: 4px;
    background: hsl(var(--h) var(--sat) calc(var(--l-panel) + 10%));
    color: var(--text);
    font-size: 10px;
    font-weight: 700;
  }

  .result-title {
    max-width: 100%;
    overflow: hidden;
    color: var(--text);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .result-content {
    min-width: 0;
    max-width: 100%;
    margin: 0;
    overflow-wrap: break-word;
    font-size: 12px;
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .result-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .search-message {
    margin: 0;
    color: var(--muted);
    font-size: 12px;
    font-style: italic;
  }

  .search-message.error {
    color: var(--danger, #dc2626);
  }

  @media (max-width: 720px) {
    .search-bar {
      grid-template-columns: 1fr;
    }
  }
</style>
