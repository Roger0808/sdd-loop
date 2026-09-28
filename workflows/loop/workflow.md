---
schema: sdd-workflow/v1
route: loop
review: required
signoff: submitter
stages:
  - { id: requirements, needs: [] }
  - { id: architecture, needs: [requirements] }
  - { id: specification, needs: [architecture] }
  - { id: tasks, needs: [specification] }
  - { id: implementation, needs: [tasks] }
  - { id: deployment, needs: [implementation] }
  - { id: manual_test, needs: [deployment] }
  - { id: verification, needs: [manual_test] }
  - { id: final_test, needs: [verification] }
  - { id: reconciliation, needs: [final_test] }
  - { id: review, needs: [reconciliation] }
  - { id: signoff, needs: [review] }
  - { id: close, needs: [signoff] }
---

# Loop

Requirements、Architecture、Specification、Tasks、Implementation、Verification 六份阶段文档仍必须存在。部署与人工测试可在正式验证和审查之前反复进行；每轮只记录事实。产品决定当场确认，稳定候选形成后差量回写受影响条款。正式 Review 和签署绑定稳定候选的源码清单。
