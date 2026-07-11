# CareBand v0.2 交付文档索引

本目录只记录可核验的比赛主链路材料。模板、待办和未勾选验收不等于真实证据。

## 架构与演示

- [本地真实闭环架构](architecture.md)
- [三分钟 Demo Runbook](demo_runbook.md)
- [180 秒软件模拟镜头表](shot_list_180s.md)
- [Fallback 矩阵](fallback_matrix.md)
- [浏览器验收与截图证据](browser_qa.md)
- [排练清单](rehearsal_checklist.md)
- [评委 Q&A](judge_qa.md)

## ESP32-S3 原型

- [BOM](hardware/bom.md)
- [接线](hardware/wiring.md)
- [配置、烧录与串口验证](hardware/flashing.md)
- [规范事件契约](hardware/event_contract.md)
- [三次实体闭环验收表](hardware/acceptance.md)

固件位于 `firmware/careband_esp32_s3/`。软件状态机与目标板编译可以自动验证；在有开发板、COM 口和局域网后端前，实体验收保持未完成。

## 访谈与隐私

- [三角色访谈指南](interview_guide.md)
- [邀请草稿](interview_invitation_drafts.md)
- [匿名记录空白模板](interview_notes/)
- [洞察汇总（当前为空）](insights.md)
- [访谈驱动 PRD 变更（当前为空）](prd_changes.md)
- [澳门 Demo / 访谈参与者说明草案](privacy/participant_information_macau_demo.md)
- [分项录音/录像同意草案](privacy/recording_consent.md)
- [撤回/删除申请草案](privacy/withdrawal_deletion_request.md)

隐私文书是待负责人及本地专业人士复核的工作模板，不构成法律意见。没有真实匿名记录时，不得在洞察或路演中生成访谈结论。

## 当前证据边界

| 项目 | 当前可表述 | 不能表述 |
| --- | --- | --- |
| 按钮状态机 | native 自动测试通过后可引用测试输出 | 已完成实体三轮验证 |
| ESP32 固件 | PlatformIO 目标板编译通过后可称“可编译” | 已烧录、已联网、已现场稳定 |
| 隐私与访谈 | 已有草案、邀请和空白模板 | 已完成正式法律审查 / 已获得真实反馈 |
| 演示 | 自动软件主链路连续三轮通过；浏览器完整闭环一轮与 2:13 录屏已有证据 | 已完成人工现场三轮 / 实体硬件三轮，除非对应验收表有真实记录 |
