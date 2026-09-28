---
schema: sdd-workflow/v1
route: hotfix
review: required
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

# Hotfix

独立单文档修复通道。手测循环轻记录，稳定候选后执行最终测试、架构对账、独立审查和动态签署。
