import type { DecisionRule } from "@/lib/capp/types"

export const DEFAULT_RULES: DecisionRule[] = [
  {
    id: "blank-thickness",
    topic: "blank",
    question: "什么时候用板材，什么时候用块料？",
    logic: "厚度不超过 30 mm、外形接近矩形时用板材；更厚或六面都要加工时用块料。",
    enabled: true,
  },
  {
    id: "blank-round",
    topic: "blank",
    question: "什么时候用圆钢下料？",
    logic: "回转体或大量外圆加工时才用圆钢，本阶段夹具底板/压板一般不用。",
    enabled: true,
  },
  {
    id: "seq-datum",
    topic: "sequence",
    question: "第一道切削为什么必须先铣基准？",
    logic: "毛坯基准未加工时，先铣大面（及相邻侧面），后续外形、孔、槽都靠这组基准。",
    enabled: true,
  },
  {
    id: "seq-hole",
    topic: "sequence",
    question: "高精度孔怎么拆工序？",
    logic: "有 H7/H8 等配合孔时，按钻→扩（可选）→铰拆开，不能一钻到尺寸。",
    enabled: true,
  },
  {
    id: "seq-slot-after-hole",
    topic: "sequence",
    question: "开口、腰槽和孔谁先谁后？",
    logic: "孔与开口/槽有位置关系时，先加工孔，再铣开，避免开口后刚性变差。",
    enabled: true,
  },
  {
    id: "fix-batch",
    topic: "fixture",
    question: "什么时候上专用夹具？",
    logic: "批量大于等于 50 件，或外形不规则、平口钳不好定位时，用专用/靠形夹具。",
    enabled: true,
  },
  {
    id: "fix-general",
    topic: "fixture",
    question: "什么时候用通用装夹就够？",
    logic: "小批量、外形规矩的底板和压板，平口钳或压板压紧即可。",
    enabled: true,
  },
]
