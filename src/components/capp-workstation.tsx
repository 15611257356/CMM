"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PILOT_CASES } from "@/lib/capp/cases"
import { compareWithActual } from "@/lib/capp/generate"
import { useCappStore } from "@/lib/capp/store"
import Link from "next/link"
import { useEffect, useState } from "react"

const TOPIC = { blank: "毛坯", sequence: "工序", fixture: "装夹" } as const

export function CappWorkstation() {
  const hydrate = useCappStore((s) => s.hydrate)
  useEffect(() => {
    hydrate()
  }, [hydrate])

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-background">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <div>
          <p className="text-[11px] text-muted-foreground">舅舅公司 · 模块二起步阶段</p>
          <h1 className="text-base font-semibold">CAPP 工艺规划工作台</h1>
        </div>
        <div className="flex gap-2">
          <Link href="/">
            <Button size="sm" variant="outline">
              返回首页
            </Button>
          </Link>
        </div>
      </header>

      <div className="hidden min-h-0 flex-1 lg:grid lg:grid-cols-[260px_minmax(0,1fr)_320px]">
        <aside className="min-h-0 border-r">
          <CaseList />
        </aside>
        <section className="min-h-0">
          <CenterPane />
        </section>
        <aside className="min-h-0 border-l">
          <ReviewPane />
        </aside>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:hidden">
        <Tabs defaultValue="cases" className="flex min-h-0 flex-1 gap-0">
          <div className="border-b px-2 py-1.5">
            <TabsList className="w-full">
              <TabsTrigger value="cases">零件</TabsTrigger>
              <TabsTrigger value="rules">规则</TabsTrigger>
              <TabsTrigger value="plan">生成</TabsTrigger>
              <TabsTrigger value="review">审核</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="cases" className="min-h-0 overflow-hidden">
            <CaseList />
          </TabsContent>
          <TabsContent value="rules" className="min-h-0 overflow-hidden">
            <RulesPane />
          </TabsContent>
          <TabsContent value="plan" className="min-h-0 overflow-hidden">
            <PlanPane />
          </TabsContent>
          <TabsContent value="review" className="min-h-0 overflow-hidden">
            <ReviewPane />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

function CaseList() {
  const selectedId = useCappStore((s) => s.selectedId)
  const selectCase = useCappStore((s) => s.selectCase)
  const reviews = useCappStore((s) => s.reviews)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-3 py-2">
        <p className="text-[11px] text-muted-foreground">试点零件（两类 × 5 件）</p>
      </div>
      <ScrollArea className="min-h-0 flex-1 px-2 pb-3">
        {(["base-plate", "clamp-plate"] as const).map((family) => (
          <div key={family} className="mb-3">
            <p className="px-1 pb-1 text-xs text-muted-foreground">
              {family === "base-plate" ? "底板类夹具" : "压板类夹具"}
            </p>
            <ul className="space-y-1">
              {PILOT_CASES.filter((c) => c.family === family).map((c) => {
                const review = reviews.find((r) => r.caseId === c.id)
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => selectCase(c.id)}
                      className={`w-full rounded-lg px-2 py-2 text-left text-sm ${
                        selectedId === c.id ? "bg-sidebar-accent" : "hover:bg-muted/60"
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-medium">{c.name}</span>
                        {review?.status === "accepted" ? (
                          <Badge variant="secondary">可接受</Badge>
                        ) : review?.status === "adjust" ? (
                          <Badge variant="destructive">需调整</Badge>
                        ) : (
                          <Badge variant="outline">待审</Badge>
                        )}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {c.id} · {c.material} · {c.thicknessMm} mm · {c.lotSize} 件
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </ScrollArea>
    </div>
  )
}

function CenterPane() {
  return (
    <Tabs defaultValue="plan" className="flex h-full min-h-0 flex-col gap-0">
      <div className="border-b px-3 py-1.5">
        <TabsList>
          <TabsTrigger value="plan">自动生成</TabsTrigger>
          <TabsTrigger value="rules">决策采集表</TabsTrigger>
          <TabsTrigger value="actual">实际工艺卡</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="plan" className="min-h-0">
        <PlanPane />
      </TabsContent>
      <TabsContent value="rules" className="min-h-0">
        <RulesPane />
      </TabsContent>
      <TabsContent value="actual" className="min-h-0">
        <ActualPane />
      </TabsContent>
    </Tabs>
  )
}

function PlanPane() {
  const selectedId = useCappStore((s) => s.selectedId)
  const generated = useCappStore((s) => s.generated)
  const generate = useCappStore((s) => s.generate)
  const part = PILOT_CASES.find((c) => c.id === selectedId)
  if (!part) return null
  const diff = generated ? compareWithActual(part, generated) : null

  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 p-4">
        <div>
          <h2 className="text-sm font-semibold">{part.name}</h2>
          <p className="text-xs text-muted-foreground">
            特征：{part.features.join("，")}
          </p>
        </div>
        <Button onClick={generate}>按当前规则生成工艺</Button>
        {!generated ? (
          <p className="text-sm text-muted-foreground">
            还没有生成结果。规则来自右侧采集表，改完规则再点生成。
          </p>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">毛坯建议</p>
              <p className="font-medium">{generated.blank}</p>
              <p className="text-muted-foreground">{generated.blankReason}</p>
              {diff ? (
                <p className={diff.blankMatch ? "mt-1 text-teal-500" : "mt-1 text-amber-500"}>
                  {diff.blankMatch ? "与实际工艺卡一致" : `实际采用：${part.actualBlank}`}
                </p>
              ) : null}
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">装夹方式</p>
              <p className="font-medium">{generated.fixture}</p>
              <p className="text-muted-foreground">{generated.fixtureReason}</p>
              {diff ? (
                <p className={diff.fixtureMatch ? "mt-1 text-teal-500" : "mt-1 text-amber-500"}>
                  {diff.fixtureMatch ? "与实际工艺卡一致" : `实际采用：${part.actualFixture}`}
                </p>
              ) : null}
            </div>
            <div>
              <p className="mb-2 text-xs text-muted-foreground">工序顺序</p>
              <ol className="space-y-2">
                {generated.steps.map((s) => (
                  <li key={s.seq} className="rounded-lg border px-3 py-2">
                    <span className="font-mono text-xs text-muted-foreground">{String(s.seq).padStart(2, "0")}</span>{" "}
                    <span className="font-medium">{s.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{s.machine}</span>
                    <p className="text-muted-foreground">{s.content}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  )
}

function RulesPane() {
  const rules = useCappStore((s) => s.rules)
  const toggleRule = useCappStore((s) => s.toggleRule)
  const updateRuleLogic = useCappStore((s) => s.updateRuleLogic)

  return (
    <ScrollArea className="h-full">
      <div className="space-y-3 p-4">
        <p className="text-sm text-muted-foreground">
          工艺判断由工程师提供，系统只负责记录并执行。关掉某条规则后，生成时不再使用它。
        </p>
        {rules.map((rule) => (
          <div key={rule.id} className="rounded-lg border p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <Badge variant="outline">{TOPIC[rule.topic]}</Badge>
              <Button size="xs" variant={rule.enabled ? "secondary" : "outline"} onClick={() => toggleRule(rule.id)}>
                {rule.enabled ? "已启用" : "已停用"}
              </Button>
            </div>
            <p className="text-sm font-medium">{rule.question}</p>
            <textarea
              className="mt-2 w-full rounded-md border bg-transparent p-2 text-sm"
              rows={3}
              value={rule.logic}
              onChange={(e) => updateRuleLogic(rule.id, e.target.value)}
            />
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}

function ActualPane() {
  const selectedId = useCappStore((s) => s.selectedId)
  const part = PILOT_CASES.find((c) => c.id === selectedId)
  if (!part) return null
  return (
    <ScrollArea className="h-full">
      <div className="space-y-3 p-4 text-sm">
        <p>
          实际毛坯：<span className="font-medium">{part.actualBlank}</span> · 实际装夹：
          <span className="font-medium">{part.actualFixture}</span>
        </p>
        <p className="text-muted-foreground">{part.note}</p>
        <ol className="space-y-2">
          {part.actualRoute.map((s) => (
            <li key={s.seq} className="rounded-lg border px-3 py-2">
              {s.seq}. {s.name} · {s.machine}
              <p className="text-muted-foreground">{s.content}</p>
            </li>
          ))}
        </ol>
      </div>
    </ScrollArea>
  )
}

function ReviewPane() {
  const selectedId = useCappStore((s) => s.selectedId)
  const reviews = useCappStore((s) => s.reviews)
  const review = useCappStore((s) => s.review)
  const [comment, setComment] = useState("")
  const current = reviews.find((r) => r.caseId === selectedId)
  const accepted = reviews.filter((r) => r.status === "accepted").length
  const adjust = reviews.filter((r) => r.status === "adjust").length
  const pending = PILOT_CASES.length - accepted - adjust

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b px-3 py-3 text-sm">
        <p className="text-[11px] text-muted-foreground">阶段评估（工程师可接受度）</p>
        <p className="mt-1">
          可接受 {accepted} · 需调整 {adjust} · 未审 {pending}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          评判标准不是模型分数，而是工艺员是否认这张路线。
        </p>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        <p className="text-xs text-muted-foreground">当前件审核</p>
        {current ? (
          <p className="text-sm">
            上次：{current.status === "accepted" ? "可接受" : "需调整"}
            {current.comment ? ` · ${current.comment}` : ""}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">这件还没有审核意见。</p>
        )}
        <textarea
          className="min-h-24 w-full rounded-md border bg-transparent p-2 text-sm"
          placeholder="需调整时写明改哪一步，例如：铰孔应放在铣槽之后"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            className="flex-1"
            onClick={() => {
              review("accepted", comment)
              setComment("")
            }}
          >
            可接受
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1"
            onClick={() => {
              review("adjust", comment)
              setComment("")
            }}
          >
            需调整
          </Button>
        </div>
      </div>
    </div>
  )
}
