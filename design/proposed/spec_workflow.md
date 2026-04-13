# Task workflow specification

Task states

- created
- scheduled
- in progress
- proposed (new)
- implemented
- discarded
- failed

New fields:

Task.spec: str
Task.want_design_doc: bool

1. User creates Task (minimal data: title, want_design_doc True or False)
2. User schedules TASK
3. LLM get task with MCP ----------
4. LLM checks want_design_doc
5. If task.want_design_doc==True and task.design_doc==None|""
   - LLM writes design doc and stores it with MCP
   - MCP server transition Task to state 'PROPOSED'
   - LLM calls get_next_task() and continues
   - User verifies design doc
      - rejected: state DISCARDED
      - accepted: state SCHEDULED now with existing design doc
   - RETURN
6. If task.design_doc == None

- LLM optionally writes a design doc (as it sometimes does already)

7. LLM implements task
8. LLM commits
9. LMM marks task as completed
