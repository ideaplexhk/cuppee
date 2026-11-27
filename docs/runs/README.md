# Run reports

One file per agent run: `YYYY-MM-DD-<task-id>.md`, newest wins. The next run reads the latest one first.

## Template

```markdown
# Run YYYY-MM-DD: <task id> <task name>

- Trigger: scheduled (hourly overnight) / on demand
- Branch and PR: agent/<id>-<slug>, <PR link>
- Result: shipped / draft / blocked

## Done
- 

## Self-proof
- verify.sh: PASS / FAIL / could not run (why)
- Screenshots: <where>
- Reviewer: VERDICT <...> @ <sha>, rounds <n>

## Blocked or skipped tasks
- <task>: <question id or reason>

## New questions for the owner
- Q<n>: <question> (recommendation: <...>)

## Next run should
- 
```
