# Settings & Preferences Specification

**Status**: Draft
**Created**: 2026-01-19
**Owner**: Eric

## 背景与目标
设置与偏好项数量多且分散，容易与业务域耦合。目标是统一偏好项的存储与渲染入口。

## 范围（In Scope）
- 用户偏好（主题、字体、语言、快捷键）。
- Provider/Model 配置的持久化入口。
- 设置页与分类导航结构。

## 非目标（Out of Scope）
- 模型能力探测与运行时校验。
- Conversation 消息与执行逻辑。

## 用户故事
- 用户修改偏好后全局即时生效。
- Provider 配置变更后模型列表更新。

## 验收标准
- Settings 只管理配置与持久化，不包含执行逻辑。
- 配置变更通过适配层广播给依赖域。

## 约束与假设
- 设置项具备向后兼容的持久化格式。

## 开放问题
无。
