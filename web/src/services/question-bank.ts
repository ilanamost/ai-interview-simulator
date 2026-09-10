import type { InterviewType, JobTitle } from '@/types/interview'

/**
 * Curated bank backing the Stage 1 mock source.
 * Technical questions are per job title; behavioral and system-design are shared,
 * since those rounds ask broadly the same things regardless of the discipline.
 */
export interface BankEntry {
  id: string
  text: string
  topic: string
  keywords: string[]
  followUp: {
    id: string
    text: string
    keywords: string[]
  }
}

const technical: Record<JobTitle, BankEntry[]> = {
  frontend: [
    {
      id: 'fe-rendering',
      text: 'Walk me through what happens between a user clicking a link in a single-page app and the new view appearing on screen.',
      topic: 'Rendering',
      keywords: ['router', 'history', 'component', 'render', 'state', 'fetch'],
      followUp: {
        id: 'fe-rendering-f',
        text: 'Where in that sequence would a slow API call become visible to the user, and how would you cover it?',
        keywords: ['loading', 'skeleton', 'suspense', 'cache', 'optimistic']
      }
    },
    {
      id: 'fe-state',
      text: 'How do you decide whether a piece of state belongs in a component, a shared store, or the URL?',
      topic: 'State management',
      keywords: ['local', 'store', 'url', 'shared', 'scope', 'persist'],
      followUp: {
        id: 'fe-state-f',
        text: 'Give an example of state you deliberately kept out of a global store, and what went wrong when it was in there.',
        keywords: ['coupling', 'example', 'refactor', 'local', 'leak']
      }
    },
    {
      id: 'fe-perf',
      text: 'A page feels sluggish on mid-range phones but fine on your laptop. How do you find the cause?',
      topic: 'Performance',
      keywords: ['profile', 'measure', 'bundle', 'throttle', 'lighthouse', 'reflow'],
      followUp: {
        id: 'fe-perf-f',
        text: 'Say the profile shows long tasks in JavaScript, not network. What are your options?',
        keywords: ['split', 'defer', 'memo', 'virtualize', 'worker']
      }
    },
    {
      id: 'fe-a11y',
      text: 'What does it take for a custom dropdown component to be genuinely accessible?',
      topic: 'Accessibility',
      keywords: ['keyboard', 'focus', 'aria', 'role', 'screen reader', 'escape'],
      followUp: {
        id: 'fe-a11y-f',
        text: 'How would you verify that, beyond running an automated audit?',
        keywords: ['manual', 'keyboard', 'screen reader', 'test', 'user']
      }
    },
    {
      id: 'fe-css',
      text: 'How do you keep a styling layer maintainable as an app grows past a few dozen components?',
      topic: 'CSS architecture',
      keywords: ['variable', 'token', 'scope', 'naming', 'reuse', 'cascade'],
      followUp: {
        id: 'fe-css-f',
        text: 'What is your rule for when a style should become a shared token rather than staying local?',
        keywords: ['token', 'repeat', 'design', 'shared', 'threshold']
      }
    }
  ],
  backend: [
    {
      id: 'be-api',
      text: 'How do you design an endpoint that has to stay backward compatible while the payload keeps evolving?',
      topic: 'API design',
      keywords: ['version', 'contract', 'optional', 'deprecate', 'schema', 'compatible'],
      followUp: {
        id: 'be-api-f',
        text: 'A client depends on a field you need to remove. Walk me through the removal.',
        keywords: ['deprecate', 'notify', 'metric', 'timeline', 'migrate']
      }
    },
    {
      id: 'be-db',
      text: 'A query that was fast last quarter now takes eight seconds. How do you approach it?',
      topic: 'Databases',
      keywords: ['explain', 'index', 'plan', 'volume', 'scan', 'measure'],
      followUp: {
        id: 'be-db-f',
        text: 'You add an index and it gets faster. What could that index cost you elsewhere?',
        keywords: ['write', 'storage', 'insert', 'maintenance', 'tradeoff']
      }
    },
    {
      id: 'be-concurrency',
      text: 'Two requests try to update the same record at the same time. How do you keep the result correct?',
      topic: 'Concurrency',
      keywords: ['lock', 'transaction', 'version', 'atomic', 'race', 'isolation'],
      followUp: {
        id: 'be-concurrency-f',
        text: 'What breaks if you scale that from one server to twenty?',
        keywords: ['distributed', 'shared', 'database', 'lock', 'coordination']
      }
    },
    {
      id: 'be-error',
      text: 'How do you decide what an API returns to a client when something fails internally?',
      topic: 'Error handling',
      keywords: ['status', 'code', 'message', 'log', 'leak', 'safe'],
      followUp: {
        id: 'be-error-f',
        text: 'How do you connect a user reporting an error to the specific log line that caused it?',
        keywords: ['request', 'id', 'correlation', 'trace', 'log']
      }
    },
    {
      id: 'be-auth',
      text: 'Describe how you would enforce that one tenant can never read another tenant’s data.',
      topic: 'Authorization',
      keywords: ['org', 'scope', 'query', 'middleware', 'token', 'boundary'],
      followUp: {
        id: 'be-auth-f',
        text: 'How would you catch it in tests if someone later wrote a query that forgot that scoping?',
        keywords: ['test', 'lint', 'review', 'default', 'fail']
      }
    }
  ],
  fullstack: [
    {
      id: 'fs-boundary',
      text: 'How do you decide whether a piece of logic belongs on the client or the server?',
      topic: 'Boundaries',
      keywords: ['trust', 'validate', 'latency', 'duplicate', 'security', 'server'],
      followUp: {
        id: 'fs-boundary-f',
        text: 'Which validation would you knowingly duplicate on both sides, and why?',
        keywords: ['ux', 'security', 'duplicate', 'trust', 'feedback']
      }
    },
    {
      id: 'fs-contract',
      text: 'How do you keep frontend and backend from drifting apart as an API changes?',
      topic: 'Contracts',
      keywords: ['type', 'schema', 'shared', 'contract', 'generate', 'test'],
      followUp: {
        id: 'fs-contract-f',
        text: 'Who finds the breakage first in your setup: a developer, CI, or a user?',
        keywords: ['ci', 'test', 'type', 'early', 'pipeline']
      }
    },
    {
      id: 'fs-feature',
      text: 'Take a feature you shipped end to end. How did you slice the work?',
      topic: 'Delivery',
      keywords: ['slice', 'incremental', 'ship', 'flag', 'scope', 'deploy'],
      followUp: {
        id: 'fs-feature-f',
        text: 'What did you cut from the first version, and did that turn out to be right?',
        keywords: ['scope', 'cut', 'learn', 'iterate', 'feedback']
      }
    },
    {
      id: 'fs-debug',
      text: 'A bug only reproduces in production. Where do you start?',
      topic: 'Debugging',
      keywords: ['log', 'reproduce', 'environment', 'data', 'diff', 'narrow'],
      followUp: {
        id: 'fs-debug-f',
        text: 'What do you add to the system so the next one is easier to catch?',
        keywords: ['observability', 'log', 'metric', 'alert', 'trace']
      }
    },
    {
      id: 'fs-tradeoff',
      text: 'Describe a time you chose the slower, more careful implementation over the quick one.',
      topic: 'Tradeoffs',
      keywords: ['tradeoff', 'risk', 'maintain', 'decision', 'cost', 'example'],
      followUp: {
        id: 'fs-tradeoff-f',
        text: 'How did you explain that cost to someone who wanted it shipped sooner?',
        keywords: ['communicate', 'stakeholder', 'risk', 'explain', 'align']
      }
    }
  ],
  devops: [
    {
      id: 'do-pipeline',
      text: 'Walk me through what happens between a merged pull request and code serving traffic.',
      topic: 'CI/CD',
      keywords: ['build', 'test', 'artifact', 'deploy', 'stage', 'rollback'],
      followUp: {
        id: 'do-pipeline-f',
        text: 'Where in that pipeline would a bad change most likely slip through?',
        keywords: ['gap', 'test', 'coverage', 'manual', 'gate']
      }
    },
    {
      id: 'do-incident',
      text: 'You are paged at 3am for elevated error rates. What are your first ten minutes?',
      topic: 'Incident response',
      keywords: ['assess', 'impact', 'rollback', 'dashboard', 'communicate', 'mitigate'],
      followUp: {
        id: 'do-incident-f',
        text: 'When do you stop investigating and just roll back?',
        keywords: ['mitigate', 'first', 'rollback', 'impact', 'decision']
      }
    },
    {
      id: 'do-observability',
      text: 'What do you instrument in a new service before it takes real traffic?',
      topic: 'Observability',
      keywords: ['metric', 'log', 'trace', 'alert', 'latency', 'error rate'],
      followUp: {
        id: 'do-observability-f',
        text: 'How do you keep alerts from becoming noise people ignore?',
        keywords: ['threshold', 'actionable', 'noise', 'page', 'tune']
      }
    },
    {
      id: 'do-iac',
      text: 'How do you manage infrastructure so environments do not drift apart?',
      topic: 'Infrastructure as code',
      keywords: ['code', 'declarative', 'state', 'review', 'reproducible', 'drift'],
      followUp: {
        id: 'do-iac-f',
        text: 'Someone changes something by hand in the console. How do you find out?',
        keywords: ['drift', 'detect', 'plan', 'audit', 'reconcile']
      }
    },
    {
      id: 'do-secret',
      text: 'How do secrets get from storage into a running process without ever landing in a repo?',
      topic: 'Secrets',
      keywords: ['vault', 'env', 'inject', 'rotate', 'access', 'runtime'],
      followUp: {
        id: 'do-secret-f',
        text: 'A key leaks. What happens in the next hour?',
        keywords: ['rotate', 'revoke', 'audit', 'scope', 'respond']
      }
    }
  ],
  data: [
    {
      id: 'da-pipeline',
      text: 'How do you build a pipeline that people trust the numbers from?',
      topic: 'Pipelines',
      keywords: ['validate', 'test', 'lineage', 'idempotent', 'monitor', 'quality'],
      followUp: {
        id: 'da-pipeline-f',
        text: 'A daily job silently produced half the usual rows. How would you have caught it?',
        keywords: ['check', 'threshold', 'alert', 'volume', 'anomaly']
      }
    },
    {
      id: 'da-modeling',
      text: 'How do you decide on the grain of a table when modeling for analytics?',
      topic: 'Modeling',
      keywords: ['grain', 'fact', 'dimension', 'aggregate', 'query', 'duplicate'],
      followUp: {
        id: 'da-modeling-f',
        text: 'What goes wrong when the grain is misunderstood by whoever queries it?',
        keywords: ['double count', 'join', 'wrong', 'aggregate', 'document']
      }
    },
    {
      id: 'da-quality',
      text: 'A stakeholder says a dashboard number looks wrong. How do you investigate?',
      topic: 'Data quality',
      keywords: ['source', 'trace', 'reproduce', 'definition', 'compare', 'lineage'],
      followUp: {
        id: 'da-quality-f',
        text: 'Often the number is right and the definition was different. How do you prevent that?',
        keywords: ['definition', 'document', 'metric', 'align', 'shared']
      }
    },
    {
      id: 'da-scale',
      text: 'A transformation that ran in ten minutes now takes four hours. How do you approach it?',
      topic: 'Scale',
      keywords: ['partition', 'incremental', 'shuffle', 'profile', 'volume', 'skew'],
      followUp: {
        id: 'da-scale-f',
        text: 'When is reprocessing everything the right answer despite the cost?',
        keywords: ['backfill', 'correctness', 'incremental', 'tradeoff', 'cost']
      }
    },
    {
      id: 'da-comm',
      text: 'How do you present an analysis to people who will make a decision from it?',
      topic: 'Communication',
      keywords: ['audience', 'caveat', 'confidence', 'clear', 'recommend', 'context'],
      followUp: {
        id: 'da-comm-f',
        text: 'How do you convey uncertainty without the finding being dismissed?',
        keywords: ['uncertainty', 'range', 'confidence', 'honest', 'framing']
      }
    }
  ]
}

const behavioral: BankEntry[] = [
  {
    id: 'bh-conflict',
    text: 'Tell me about a technical disagreement with a colleague. How did it end?',
    topic: 'Collaboration',
    keywords: ['listen', 'evidence', 'resolve', 'compromise', 'outcome', 'respect'],
    followUp: {
      id: 'bh-conflict-f',
      text: 'Looking back, was the decision you landed on the right one?',
      keywords: ['reflect', 'hindsight', 'learn', 'outcome', 'honest']
    }
  },
  {
    id: 'bh-failure',
    text: 'Describe something you shipped that did not work out. What did you do about it?',
    topic: 'Ownership',
    keywords: ['own', 'impact', 'fix', 'learn', 'communicate', 'example'],
    followUp: {
      id: 'bh-failure-f',
      text: 'What changed in how you work because of it?',
      keywords: ['change', 'process', 'habit', 'learn', 'apply']
    }
  },
  {
    id: 'bh-ambiguity',
    text: 'Tell me about a project where the requirements were unclear. How did you move forward?',
    topic: 'Ambiguity',
    keywords: ['clarify', 'assumption', 'stakeholder', 'prototype', 'iterate', 'question'],
    followUp: {
      id: 'bh-ambiguity-f',
      text: 'What assumption did you make that turned out to be wrong?',
      keywords: ['assumption', 'wrong', 'adjust', 'discover', 'correct']
    }
  },
  {
    id: 'bh-priority',
    text: 'You have more work than time and everything is marked urgent. Walk me through your week.',
    topic: 'Prioritization',
    keywords: ['prioritize', 'impact', 'communicate', 'negotiate', 'deadline', 'tradeoff'],
    followUp: {
      id: 'bh-priority-f',
      text: 'How do you tell someone their request is not happening this week?',
      keywords: ['communicate', 'expectation', 'honest', 'alternative', 'early']
    }
  },
  {
    id: 'bh-growth',
    text: 'What is something you learned recently because the work demanded it?',
    topic: 'Growth',
    keywords: ['learn', 'approach', 'apply', 'resource', 'practice', 'example'],
    followUp: {
      id: 'bh-growth-f',
      text: 'How do you know when you understand something well enough to rely on it?',
      keywords: ['test', 'apply', 'explain', 'confidence', 'verify']
    }
  }
]

const systemDesign: BankEntry[] = [
  {
    id: 'sd-scope',
    text: 'Design a URL shortener. Start by telling me what you would clarify before drawing anything.',
    topic: 'Requirements',
    keywords: ['scale', 'requirement', 'read', 'write', 'constraint', 'clarify'],
    followUp: {
      id: 'sd-scope-f',
      text: 'Which of those answers would most change your design?',
      keywords: ['scale', 'tradeoff', 'driver', 'change', 'constraint']
    }
  },
  {
    id: 'sd-storage',
    text: 'How do you choose a datastore for a workload you have not built yet?',
    topic: 'Storage',
    keywords: ['access pattern', 'consistency', 'scale', 'query', 'tradeoff', 'relational'],
    followUp: {
      id: 'sd-storage-f',
      text: 'When would you accept eventual consistency, and when would you refuse it?',
      keywords: ['consistency', 'money', 'user', 'tradeoff', 'stale']
    }
  },
  {
    id: 'sd-scale',
    text: 'A service handles a thousand requests per second and needs to handle fifty thousand. What changes?',
    topic: 'Scaling',
    keywords: ['cache', 'horizontal', 'bottleneck', 'queue', 'shard', 'measure'],
    followUp: {
      id: 'sd-scale-f',
      text: 'What is likely to break first that is not the application servers?',
      keywords: ['database', 'connection', 'bottleneck', 'downstream', 'limit']
    }
  },
  {
    id: 'sd-failure',
    text: 'How do you design a system so one failing dependency does not take everything down?',
    topic: 'Resilience',
    keywords: ['timeout', 'retry', 'circuit', 'fallback', 'isolate', 'degrade'],
    followUp: {
      id: 'sd-failure-f',
      text: 'Retries can make an outage worse. How do you keep that from happening?',
      keywords: ['backoff', 'jitter', 'budget', 'limit', 'amplify']
    }
  },
  {
    id: 'sd-async',
    text: 'When would you move work into a queue instead of handling it in the request?',
    topic: 'Async processing',
    keywords: ['latency', 'queue', 'async', 'retry', 'decouple', 'durability'],
    followUp: {
      id: 'sd-async-f',
      text: 'What new problems does that queue introduce?',
      keywords: ['ordering', 'duplicate', 'idempotent', 'backlog', 'visibility']
    }
  }
]

export function getBank(jobTitle: JobTitle, type: InterviewType): BankEntry[] {
  if (type === 'behavioral') return behavioral
  if (type === 'system-design') return systemDesign
  return technical[jobTitle]
}
