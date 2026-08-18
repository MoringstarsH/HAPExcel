# Design QA

final result: blocked

## Target

- HAP 原生台账截图中的金额前缀、单位后缀、数值右对齐、浅灰表头和只读计算列层级。

## Automated checks

- 数值格式、前后缀、百分比、千分位、零值、非数值降级和剪贴板语义均有单元测试覆盖。
- `mdye build` 成功，仅存在既有 bundle 体积告警。

## Blocker

- 当前自动化浏览器没有可用的已登录 HAP 标签页，Chrome 浏览器连接也不可用，无法获取改造后的真实 iframe 截图与参考图进行同视口对比。

## Required follow-up

- 在 HAP 调试视图加载本地 bundle 后，检查含税单价、含税金额、不含税金额等列的前后缀、编辑状态、窄列、省略状态、只读底色和选区/错误覆盖关系。
