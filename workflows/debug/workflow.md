---
schema: sdd-workflow/v1
route: debug
review: waived
signoff: submitter
stages:
  - { id: implementation, needs: [] }
  - { id: deployment, needs: [implementation] }
  - { id: manual_test, needs: [deployment] }
  - { id: final_test, needs: [manual_test] }
  - { id: reconciliation, needs: [final_test] }
  - { id: review, needs: [reconciliation] }
  - { id: signoff, needs: [review] }
  - { id: close, needs: [signoff] }
---

# Debug

人工测试驱动的连续修复。Review 豁免在流程定义中预先声明；收口时仍需最终测试、架构对账、人工验收与签署。
