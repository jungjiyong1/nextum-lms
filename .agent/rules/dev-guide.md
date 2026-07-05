---
trigger: always_on
---

## 1. Context First
> "Understand the project before writing code."

```
# [Rule] Context First
1. Before modifying code, READ `CONTEXT.md` on the root of project folder to understand project structure and conventions.
2. Respect existing patterns. Only introduce new libraries/patterns when necessary, and explain why.
3. If information is missing, ask. Do not assume.
```

---

## 2. Code & Docs Together
> "Code without updated docs is tech debt."

```
# [Rule] Living Documentation
1. When making significant code changes, update related docs in the SAME turn.
2. Log architectural decisions in `CONTEXT.md` under "Decision Log" to preserve context.
```

---

## 3. Defensive Coding
> "Prevent bugs at the source, not in production."

```
# [Rule] Defensive Coding
1. No empty catch blocks. Log errors or propagate them.
2. No `any` type unless unavoidable. If used, justify in comments.
3. Never trust external input. Validate and sanitize all user inputs and API responses.
4. Never hardcode secrets. Use environment variables.
```

---

## 4. Reversibility
> "Mistakes happen. Recovery speed matters."

```
# [Rule] Reversibility
1. Keep changes small and focused. Break large refactors into steps.
2. Before destructive changes (file deletion, data migration), remind user to commit first.
3. For risky features, suggest feature flags.
```

---

## 5. Clarity in Communication
> "Less talk, more code."

```
# [Rule] Professional Communication
1. Skip pleasantries. Go straight to the solution.
2. Prefer code examples and diffs over long explanations.
3. Self-review before presenting. Fix obvious mistakes proactively.
```

---

## Reference: `CONTEXT.md` Template
A well-structured context file makes these rules work effectively. Here's a battle-tested structure:

**File path**: `(project-root)/CONTEXT.md`
```markdown
# CONTEXT

[One-line project description]

> **Last Updated**: YYYY-MM-DD
> **Recent Changes**: [Brief summary]

---

## 📋 CHANGELOG
### YYYY-MM-DD
- Change 1
- Change 2

---

## 1. TECH STACK
| Category | Stack    | Version |
| -------- | -------- | ------- |
| Core     | React    | ^19.x   |
| DB       | Supabase | Cloud   |
| ...      | ...      | ...     |

---

## 2. PROJECT STRUCTURE
```
project-root/
├── src/
│   ├── components/
│   ├── pages/
│   ├── core/          # API, types, utils
│   └── stores/        # State management
└── ...
```

---

## 3. ARCHITECTURE
### Data Flow
```
Component → Store → API Layer → Database
```

### Key Patterns
- [State management approach]
- [Auth flow]

---

## 4. DATABASE
### Core Tables
| Table | Description   |
| ----- | ------------- |
| users | User profiles |
| ...   | ...           |

---

## 5. DEVELOPMENT RULES
- How to add new pages
- How to add new API functions
- Component patterns

---

## 6. BUILD & SCRIPTS
```bash
npm run dev    # Development
npm run build  # Production build
npm run test   # Run tests
```

---

## 7. TROUBLESHOOTING
### Common Issues
- **Issue 1**: Cause and solution
- **Issue 2**: Cause and solution

---

## 8. TODO
### In Progress
- [ ] Task 1

### Completed
- [x] Task 2

---

## 9. GUIDELINES
- Always verify build after code changes
- Minimize `any` type usage
- Follow existing patterns
- Update CONTEXT.md on major changes
```