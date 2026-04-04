# Error Logging System Setup

## ✅ Completed

### 1. Core Infrastructure
- **Created** `src/lib/error-logger.ts` - Centralized error logging utility with:
  - `logError(message, error, context, severity)` - Log errors with categorization
  - `logWarning(message, error, context)` - Log warnings
  - Auto-categorization (network, timeout, parsing, validation)
  - Context tracking (source, operation, details)

### 2. Type Definitions
- **Added** `ErrorLogEntry` type to `src/types/narrative.ts` with fields:
  - `id`, `timestamp`, `severity` (error/warning)
  - `category` (network/timeout/parsing/validation/unknown)
  - `message`, `errorMessage`, `errorStack`
  - `source` (auto-play/mcts/manual-generation/analysis/etc)
  - `operation`, `details`, `narrativeId`

- **Updated** `AppState` to include `errorLogs: ErrorLogEntry[]`

### 3. UI Component
- **Created** `src/components/topbar/ErrorLogModal.tsx` - Full-featured modal with:
  - Real-time error/warning display
  - Filtering by severity, category, source
  - Expandable entries showing full stack traces
  - Statistics dashboard
  - Clear all functionality
  - Responsive timestamps ("5m ago" format)

### 4. Partial Store Integration
- **Updated** `src/lib/store.tsx`:
  - Added `ErrorLogEntry` import
  - Added `errorLogs: []` to initial state
  - Added action types: `LOG_ERROR`, `CLEAR_ERROR_LOGS`

## ⏳ TODO - Manual Integration Required

### 1. Complete Store Integration

Add these reducer cases to `src/lib/store.tsx` after line 936 (after `HYDRATE_API_LOGS`):

```typescript
    case 'LOG_ERROR':
      return { ...state, errorLogs: [...state.errorLogs, action.entry] };

    case 'CLEAR_ERROR_LOGS':
      return { ...state, errorLogs: [] };
```

Add these hooks around line 1308 (after API logger hooks):

```typescript
  // Wire error logger to store
  useEffect(() => {
    import('@/lib/error-logger').then(({ onErrorLog }) => {
      onErrorLog((entry) => dispatch({ type: 'LOG_ERROR', entry }));
    });
  }, []);

  // Keep error logger aware of which narrative is active
  useEffect(() => {
    import('@/lib/error-logger').then(({ setErrorLoggerNarrativeId }) => {
      setErrorLoggerNarrativeId(state.activeNarrativeId);
    });
  }, [state.activeNarrativeId]);
```

### 2. Add Modal to TopBar

In `src/components/topbar/TopBar.tsx`:

```typescript
import ErrorLogModal from './ErrorLogModal';

// Add state
const [showErrorLog, setShowErrorLog] = useState(false);

// Add button near API modal button
<button
  onClick={() => setShowErrorLog(true)}
  className="..."
  title="Error & Warning Logs"
>
  🔴 Logs
</button>

// Add modal render
{showErrorLog && <ErrorLogModal onClose={() => setShowErrorLog(false)} />}
```

### 3. Add Error Logging to Generation Code

#### Auto Mode (`src/hooks/useAutoPlay.ts`)

Already has improved error messages in catch blocks. Now add logging:

```typescript
import { logError } from '@/lib/error-logger';

// In phase init catch (line ~121):
logError(
  `Phase "${ap.name}" initialization failed`,
  err,
  {
    source: 'auto-play',
    operation: 'phase-init',
    details: {
      phaseName: ap.name,
      sceneAllocation: ap.sceneAllocation,
    },
  }
);

// In direction refresh catch (line ~336):
logError(
  `Course correction failed for phase "${freshPhase?.name}"`,
  err,
  {
    source: 'auto-play',
    operation: 'course-correction',
    details: {
      phaseName: freshPhase?.name,
      scenesCompleted: knownCompleted,
      sceneAllocation: freshPhase?.sceneAllocation,
    },
  }
);

// In main cycle catch (line ~341):
logError(
  `Generation cycle ${autoRunState.currentCycle + 1} failed`,
  err,
  {
    source: 'auto-play',
    operation: 'scene-generation',
    details: {
      action,
      sceneCount,
      generationMode: activeNarrative.storySettings?.generationMode,
      phaseName: pq?.phases[pq.activePhaseIndex]?.name,
    },
  }
);
```

#### MCTS Mode (`src/hooks/useMCTS.ts`)

Find error catch blocks and add:

```typescript
import { logError } from '@/lib/error-logger';

logError(
  'MCTS expansion failed',
  err,
  {
    source: 'mcts',
    operation: 'node-expansion',
    details: {
      nodeId: parentId,
      direction,
      cubeGoal,
    },
  }
);
```

#### Manual Generation (`src/components/generation/GeneratePanel.tsx`)

Replace `catch` blocks (line ~180, ~193, ~209):

```typescript
import { logError } from '@/lib/error-logger';

catch (err) {
  logError(
    'Manual scene generation failed',
    err,
    {
      source: 'manual-generation',
      operation: 'generate-scenes',
      details: {
        sceneCount,
        generationMode: genMode,
      },
    }
  );
  setError(String(err));
}
```

#### Analysis Runner (`src/lib/analysis-runner.ts`)

Already has detailed error messages. Add logging in catch blocks:

```typescript
import { logError } from '@/lib/error-logger';

// In plan extraction failure (around line ~387):
logError(
  `Plan extraction failed for scene ${task.chunkIdx}-${task.sceneIdx}`,
  err,
  {
    source: 'analysis',
    operation: 'plan-extraction',
    details: {
      chunkIdx: task.chunkIdx,
      sceneIdx: task.sceneIdx,
      wordCount: task.prose.split(/\s+/).length,
      attempts: task.attempts,
    },
  },
  'warning' // Use warning severity for retryable failures
);
```

## Usage Example

```typescript
import { logError, logWarning } from '@/lib/error-logger';

try {
  await generateScenes(...);
} catch (err) {
  logError(
    'Scene generation failed',
    err,
    {
      source: 'auto-play',
      operation: 'generate-scenes',
      details: {
        sceneCount: 5,
        model: 'gemini-flash',
        phaseName: 'Rising Action',
      },
    }
  );
}
```

## Benefits

1. **Centralized Error Tracking**: All errors in one place
2. **Categorized & Filterable**: Filter by severity, category, source
3. **Rich Context**: See what was happening when error occurred
4. **Debugging Aid**: Stack traces and operation details
5. **User-Friendly**: Clean UI similar to API logs modal
6. **Production Ready**: Non-blocking, async logging

## Next Steps

1. Complete store integration (add reducer cases + useEffect hooks)
2. Add ErrorLogModal button to TopBar
3. Add `logError()` calls to all catch blocks in:
   - `src/hooks/useAutoPlay.ts`
   - `src/hooks/useMCTS.ts`
   - `src/components/generation/GeneratePanel.tsx`
   - `src/lib/analysis-runner.ts`
4. Test by triggering various errors and viewing in modal
5. Consider adding notification badge when new errors occur
