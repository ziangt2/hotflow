import json
import os
import time
import socket
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
HOST = os.environ.get("HOTFLOW_HOST", "0.0.0.0")
PORT = int(os.environ.get("HOTFLOW_PORT", os.environ.get("PORT", "8000")))


def load_env_file(path: Path) -> None:
  if not path.exists():
    return
  for raw_line in path.read_text(encoding="utf-8").splitlines():
    line = raw_line.strip()
    if not line or line.startswith("#") or "=" not in line:
      continue
    key, value = line.split("=", 1)
    key = key.strip()
    value = value.strip().strip('"').strip("'")
    os.environ.setdefault(key, value)


load_env_file(ROOT / ".env")
load_env_file(ROOT / ".env.local")


def parse_json_env(name: str, default: Any) -> Any:
  raw = os.environ.get(name)
  if not raw:
    return default
  try:
    return json.loads(raw)
  except json.JSONDecodeError:
    return default


def safe_int(value: Any, default: int = 0) -> int:
  if value is None:
    return default
  if isinstance(value, (int, float)):
    return int(value)
  text = str(value).strip().replace(",", "")
  digits = "".join(ch for ch in text if ch.isdigit())
  return int(digits) if digits else default


def as_list(value: Any) -> List[str]:
  if value is None:
    return []
  if isinstance(value, list):
    return [str(item).strip() for item in value if str(item).strip()]
  if isinstance(value, str):
    if "," in value:
      return [part.strip() for part in value.split(",") if part.strip()]
    if value.strip():
      return [value.strip()]
  return []


def first_present(item: Dict[str, Any], keys: List[str], default: Any = "") -> Any:
  for key in keys:
    value = item.get(key)
    if value not in (None, "", [], {}):
      return value
  return default


def platform_alias(value: str) -> str:
  text = str(value or "").strip().lower()
  mapping = {
    "douyin": "抖音",
    "抖音": "抖音",
    "tiktok": "抖音",
    "xiaohongshu": "小红书",
    "rednote": "小红书",
    "xhs": "小红书",
    "小红书": "小红书",
    "wechat_channels": "视频号",
    "wechat channel": "视频号",
    "video account": "视频号",
    "视频号": "视频号",
    "weixin": "视频号"
  }
  return mapping.get(text, value or "未知平台")


def classify_category(item: Dict[str, Any]) -> str:
  seed = " ".join(
    [
      str(first_present(item, ["category"], "")),
      str(first_present(item, ["title", "desc", "summary"], "")),
      " ".join(as_list(first_present(item, ["tags"], [])))
    ]
  ).lower()

  rules = {
    "副业": ["副业", "赚钱", "ai", "带货", "变现", "创业"],
    "餐饮": ["餐饮", "探店", "咖啡", "火锅", "奶茶", "小店", "门店"],
    "知识": ["职场", "知识", "观点", "管理", "学习", "干货"],
    "美业": ["皮肤", "美业", "团购", "护肤", "美容", "门店"],
    "教育": ["英语", "启蒙", "教育", "学习", "妈妈", "孩子"]
  }
  for category, words in rules.items():
    if any(word in seed for word in words):
      return category
  return "未分类"


def normalize_item(item: Dict[str, Any], source_name: str, fallback_platform: str = "") -> Dict[str, Any]:
  title = str(first_present(item, ["title", "aweme_title", "desc", "name"], "未命名视频")).strip()
  platform_value = platform_alias(str(first_present(item, ["platform", "source_platform"], fallback_platform)))
  summary = str(first_present(item, ["summary", "desc", "description", "content"], "暂无摘要")).strip()
  creator = str(first_present(item, ["creator", "author", "nickname", "user_name"], "未知作者")).strip()
  likes = safe_int(first_present(item, ["likes", "digg_count", "like_count", "likeCount"], 0))
  comments = safe_int(first_present(item, ["comments", "comment_count", "commentCount"], 0))
  shares = safe_int(first_present(item, ["shares", "share_count", "shareCount"], 0))
  views = safe_int(first_present(item, ["views", "play_count", "viewCount", "playCount"], 0))
  heat = safe_int(first_present(item, ["heat", "hot_score"], 0))
  if heat == 0:
    heat = min(100, round(likes * 0.002 + comments * 0.015 + shares * 0.03 + views * 0.0002))

  tags = as_list(first_present(item, ["tags", "hashtags", "keywords"], []))
  hooks = as_list(first_present(item, ["hooks"], []))
  structure = as_list(first_present(item, ["structure"], []))
  reusable_angles = as_list(first_present(item, ["reusableAngles", "reusable_angles"], []))

  velocity = str(first_present(item, ["velocity", "growth", "trend"], f"点赞 {likes} / 评论 {comments} / 分享 {shares}")).strip()
  category = str(first_present(item, ["category"], "")).strip() or classify_category(item)

  return {
    "id": str(first_present(item, ["id", "aweme_id", "note_id", "object_id"], f"{source_name}-{abs(hash(title))}")),
    "platform": platform_value,
    "category": category,
    "title": title,
    "creator": creator,
    "heat": heat,
    "velocity": velocity,
    "summary": summary,
    "tags": tags[:6],
    "hooks": hooks or infer_hooks(title, summary),
    "structure": structure or infer_structure(platform_value),
    "reusableAngles": reusable_angles or infer_reusable_angles(title, summary, category),
    "sourceName": source_name,
    "rawMetrics": {
      "likes": likes,
      "comments": comments,
      "shares": shares,
      "views": views
    }
  }


def infer_hooks(title: str, summary: str) -> List[str]:
  seed = f"{title} {summary}"
  hooks = []
  if any(token in seed for token in ["为什么", "到底", "怎么", "方法"]):
    hooks.append("问题钩子")
  if any(token in seed for token in ["一天", "3个", "10条", "三种", "清单"]):
    hooks.append("结果或列表钩子")
  if any(token in seed for token in ["省", "提升", "涨", "值", "爆"]):
    hooks.append("收益钩子")
  return hooks or ["情绪钩子", "痛点切入", "结果承诺"]


def infer_structure(platform: str) -> List[str]:
  if platform == "小红书":
    return [
      "0-2 秒点人群和场景",
      "3-12 秒快速给出 2-3 个重点",
      "13-24 秒补充体验或细节",
      "25-32 秒引导收藏或私信"
    ]
  if platform == "视频号":
    return [
      "0-4 秒抛观点或误区",
      "5-16 秒给出三段式结论",
      "17-28 秒补案例或解释",
      "29-35 秒引导转发或咨询"
    ]
  return [
    "0-3 秒强钩子打停留",
    "4-12 秒建立可信度",
    "13-26 秒拆步骤或案例",
    "27-35 秒做 CTA 转化"
  ]


def infer_reusable_angles(title: str, summary: str, category: str) -> List[str]:
  _ = summary
  angles = [
    f"把 {category} 热点结构改写成你的账号人群语言",
    "保留节奏，不照抄表达",
    "把案例替换成自己的产品或服务结果"
  ]
  if "合集" in title or "3" in title:
    angles.insert(0, "保留列表型结构做合集内容")
  return angles[:4]


def http_json(url: str, method: str = "GET", headers: Optional[Dict[str, str]] = None, body: Optional[Dict[str, Any]] = None) -> Any:
  data = None
  if body is not None:
    data = json.dumps(body).encode("utf-8")
  request = urllib.request.Request(url, data=data, method=method)
  for key, value in (headers or {}).items():
    request.add_header(key, value)
  request.add_header("Accept", "application/json")
  if body is not None:
    request.add_header("Content-Type", "application/json")
  timeout = float(os.environ.get("HOTFLOW_HTTP_TIMEOUT_SECONDS", "25"))
  with urllib.request.urlopen(request, timeout=timeout) as response:
    charset = response.headers.get_content_charset() or "utf-8"
    payload = response.read().decode(charset)
    return json.loads(payload)


@dataclass
class SourceResult:
  name: str
  ok: bool
  count: int
  items: List[Dict[str, Any]]
  message: str = ""


class LocalJsonSource:
  def __init__(self, path: Path):
    self.path = path

  def fetch(self) -> SourceResult:
    if not self.path.exists():
      return SourceResult("本地 JSON", False, 0, [], f"{self.path.name} 不存在")
    try:
      payload = json.loads(self.path.read_text(encoding="utf-8"))
      items = payload if isinstance(payload, list) else payload.get("items", [])
      normalized = [normalize_item(item, "local-json") for item in items if isinstance(item, dict)]
      return SourceResult("本地 JSON", True, len(normalized), normalized)
    except Exception as exc:
      return SourceResult("本地 JSON", False, 0, [], str(exc))


class RemoteJsonSource:
  def fetch(self) -> SourceResult:
    url = os.environ.get("HOTFLOW_REMOTE_JSON_URL", "").strip()
    if not url:
      return SourceResult("远程 JSON", False, 0, [], "未配置 HOTFLOW_REMOTE_JSON_URL")
    headers = parse_json_env("HOTFLOW_REMOTE_JSON_HEADERS", {})
    try:
      payload = http_json(url, headers=headers if isinstance(headers, dict) else {})
      items = payload if isinstance(payload, list) else payload.get("items", [])
      normalized = [normalize_item(item, "remote-json") for item in items if isinstance(item, dict)]
      return SourceResult("远程 JSON", True, len(normalized), normalized)
    except Exception as exc:
      return SourceResult("远程 JSON", False, 0, [], str(exc))


class ApifySource:
  def __init__(self, env_prefix: str, display_name: str, fallback_platform: str):
    self.env_prefix = env_prefix
    self.display_name = display_name
    self.fallback_platform = fallback_platform

  def fetch(self) -> SourceResult:
    token = os.environ.get("APIFY_TOKEN", "").strip()
    actor_id = os.environ.get(f"APIFY_{self.env_prefix}_ACTOR_ID", "").strip()
    if not token or not actor_id:
      return SourceResult(self.display_name, False, 0, [], "未配置 Apify")

    body = parse_json_env(f"APIFY_{self.env_prefix}_INPUT", {"limit": 10})
    actor_ref = actor_id.replace("/", "~")

    try:
      items = self._run_actor_and_fetch_items(token, actor_ref, body if isinstance(body, dict) else {"limit": 10})
      normalized = [
        normalize_item(item, f"apify-{self.env_prefix.lower()}", self.fallback_platform)
        for item in items
        if isinstance(item, dict)
      ]
      return SourceResult(self.display_name, True, len(normalized), normalized)
    except urllib.error.HTTPError as exc:
      return SourceResult(self.display_name, False, 0, [], f"HTTP Error {exc.code}: {exc.reason}")
    except socket.timeout:
      return SourceResult(self.display_name, False, 0, [], "Apify run timed out")
    except Exception as exc:
      return SourceResult(self.display_name, False, 0, [], str(exc))

  def _run_actor_and_fetch_items(self, token: str, actor_ref: str, actor_input: Dict[str, Any]) -> List[Dict[str, Any]]:
    run_url = f"https://api.apify.com/v2/acts/{actor_ref}/runs?token={urllib.parse.quote(token)}"
    run_payload = http_json(run_url, method="POST", body=actor_input)
    run_data = run_payload.get("data", {}) if isinstance(run_payload, dict) else {}
    run_id = run_data.get("id")
    if not run_id:
      raise ValueError("Apify did not return a run id")

    max_wait = int(os.environ.get("APIFY_RUN_WAIT_SECONDS", "45"))
    poll_interval = float(os.environ.get("APIFY_POLL_INTERVAL_SECONDS", "2.5"))
    deadline = time.time() + max_wait

    while time.time() < deadline:
      status_url = f"https://api.apify.com/v2/actor-runs/{run_id}?token={urllib.parse.quote(token)}"
      status_payload = http_json(status_url)
      status_data = status_payload.get("data", {}) if isinstance(status_payload, dict) else {}
      status = status_data.get("status", "")

      if status == "SUCCEEDED":
        dataset_id = status_data.get("defaultDatasetId")
        if not dataset_id:
          return []
        dataset_url = (
          f"https://api.apify.com/v2/datasets/{dataset_id}/items"
          f"?token={urllib.parse.quote(token)}&clean=true&format=json"
        )
        dataset_payload = http_json(dataset_url)
        return dataset_payload if isinstance(dataset_payload, list) else dataset_payload.get("items", [])

      if status in {"FAILED", "ABORTED", "TIMED-OUT"}:
        status_message = status_data.get("statusMessage") or status
        raise ValueError(f"Apify run failed: {status_message}")

      time.sleep(poll_interval)

    raise TimeoutError("Apify run timed out before results were ready")


class TrendRepository:
  def __init__(self):
    self.sources = [
      LocalJsonSource(DATA_DIR / "live_trends.json"),
      RemoteJsonSource(),
      ApifySource("DOUYIN", "Apify 抖音", "抖音"),
      ApifySource("XIAOHONGSHU", "Apify 小红书", "小红书"),
      ApifySource("WECHAT_CHANNELS", "Apify 视频号", "视频号")
    ]

  def list_trends(self, platform: str = "全部", category: str = "全部") -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    seen = set()
    items: List[Dict[str, Any]] = []
    statuses = []

    for source in self.sources:
      result = source.fetch()
      statuses.append(
        {
          "name": result.name,
          "ok": result.ok,
          "count": result.count,
          "message": result.message
        }
      )
      for item in result.items:
        if item["id"] in seen:
          continue
        seen.add(item["id"])
        items.append(item)

    if platform and platform != "全部":
      items = [item for item in items if item["platform"] == platform]
    if category and category != "全部":
      items = [item for item in items if item["category"] == category]

    items.sort(key=lambda entry: entry.get("heat", 0), reverse=True)
    return items, statuses


class ContentGenerator:
  def __init__(self):
    self.api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    self.model = os.environ.get("HOTFLOW_OPENAI_MODEL", "gpt-5.4-mini").strip()

  def generate(self, payload: Dict[str, Any]) -> Dict[str, Any]:
    if self.api_key:
      try:
        return self._generate_with_openai(payload)
      except Exception as exc:
        fallback = self._generate_template(payload)
        fallback["generationMode"] = f"template-fallback: {exc}"
        return fallback
    fallback = self._generate_template(payload)
    fallback["generationMode"] = "template"
    return fallback

  def _generate_with_openai(self, payload: Dict[str, Any]) -> Dict[str, Any]:
    trend = payload.get("trend", {})
    prompt = {
      "trend": trend,
      "positioning": payload.get("positioning", ""),
      "offer": payload.get("offer", ""),
      "audience": payload.get("audience", ""),
      "goal": payload.get("goal", ""),
      "tone": payload.get("tone", ""),
      "mimicLevel": payload.get("mimicLevel", "中")
    }
    body = {
      "model": self.model,
      "instructions": (
        "你是短视频增长编导。请基于热点视频结构，产出中文原创内容包。"
        "你可以模仿节奏、结构、钩子强度和转化方式，但不要逐句照抄。"
        "输出必须是 JSON 对象，不要使用 markdown。"
        "JSON 字段固定为 title, lead, script, outline, coverLines, shots, cta, hashtags。"
        "其中 outline, coverLines, shots, hashtags 必须是字符串数组。"
      ),
      "input": json.dumps(prompt, ensure_ascii=False)
    }
    response = http_json(
      "https://api.openai.com/v1/responses",
      method="POST",
      headers={"Authorization": f"Bearer {self.api_key}"},
      body=body
    )
    text = self._extract_output_text(response)
    parsed = json.loads(text)
    parsed["generationMode"] = f"openai:{self.model}"
    return parsed

  def _extract_output_text(self, response: Dict[str, Any]) -> str:
    output = response.get("output", [])
    for item in output:
      for content in item.get("content", []):
        if content.get("type") == "output_text":
          return content.get("text", "")
    raise ValueError("OpenAI 响应里没有可解析文本")

  def _generate_template(self, payload: Dict[str, Any]) -> Dict[str, Any]:
    trend = payload.get("trend", {})
    positioning = payload.get("positioning") or "你的账号"
    offer = payload.get("offer") or "你的产品"
    audience = payload.get("audience") or "目标用户"
    goal = payload.get("goal") or "私信咨询"
    tone = payload.get("tone") or "强转化、节奏快"
    mimic_level = payload.get("mimicLevel") or "中"
    category = trend.get("category", "内容")
    hooks = trend.get("hooks", [])
    structure = trend.get("structure", [])
    reusable_angles = trend.get("reusableAngles", [])
    title = f"{audience}为什么总被这类 {category} 视频吸引？我把它改成了 {offer} 的引流脚本"
    lead = (
      f"这条热点不是照搬，而是按“{mimic_level}仿爆款”模式，借它的结构和节奏，"
      f"把 {positioning} 的卖点重新组织成更容易转化的表达。"
    )
    hook_line = hooks[0] if hooks else "结果先行"
    structure_line = structure[0] if structure else "0-3 秒强钩子"
    reusable_line = reusable_angles[0] if reusable_angles else "保留结构，不照搬表达"
    script = "\n".join(
      [
        f"开头先说重点，如果你也想让 {audience} 更快注意到 {offer}，先别急着讲功能。",
        f"现在最有效的是 {hook_line}，也就是一上来先把结果或者误区抛出来，先把用户停住。",
        f"比如你可以直接说，很多人以为 {category} 内容只能靠运气爆，其实真正起量的是结构，不是运气。",
        f"接下来用一个真实场景把 {offer} 放进去，让用户立刻知道这条视频和自己有关。",
        f"然后照着爆款结构来推进，先用“{structure_line}”抢注意力，再用案例推进，再拆三步说明价值。",
        f"仿写原则是 {reusable_line}，所以你模仿的是打法，不是原句。",
        f"最后在结尾明确引导，如果你想 {goal}，评论区留关键词，我把完整方案发你。"
      ]
    )
    return {
      "title": title,
      "lead": lead,
      "script": script,
      "outline": [
        f"0-3 秒按爆款开头：{structure_line}",
        f"4-12 秒把 {audience} 的场景讲清楚",
        f"13-24 秒拆 3 步说明 {offer} 的价值",
        f"25-35 秒做 {goal} 的明确引导"
      ],
      "coverLines": [
        f"{audience}最容易被这类视频打动",
        f"我把热点结构改成了 {offer} 的引流脚本",
        f"不是照搬，是{mimic_level}度重组爆点"
      ],
      "shots": [
        "镜头 1：人物正对镜头抛结论，大字幕压住注意力",
        "镜头 2：展示案例或前后对比，建立可信度",
        "镜头 3：插入屏幕录制或场景特写，降低理解门槛",
        f"镜头 4：结尾口播 CTA，引导用户 {goal}"
      ],
      "cta": f"如果你想 {goal}，评论区留“想看”，我把完整版本发你。",
      "hashtags": [trend.get("platform", "热点"), category, offer, audience, tone, f"仿爆款{mimic_level}"]
    }


repository = TrendRepository()
generator = ContentGenerator()


class HotFlowHandler(BaseHTTPRequestHandler):
  def do_GET(self):
    parsed = urllib.parse.urlparse(self.path)
    if parsed.path == "/api/trends":
      self.handle_api_trends(parsed)
      return
    self.serve_static(parsed.path)

  def do_POST(self):
    parsed = urllib.parse.urlparse(self.path)
    if parsed.path == "/api/generate":
      self.handle_api_generate()
      return
    self.send_json({"error": "Not found"}, status=404)

  def handle_api_trends(self, parsed):
    query = urllib.parse.parse_qs(parsed.query)
    platform = query.get("platform", ["全部"])[0]
    category = query.get("category", ["全部"])[0]
    items, statuses = repository.list_trends(platform=platform, category=category)
    self.send_json(
      {
        "items": items,
        "sources": statuses,
        "fetchedAt": int(time.time())
      }
    )

  def handle_api_generate(self):
    try:
      length = int(self.headers.get("Content-Length", "0"))
      body = self.rfile.read(length).decode("utf-8") if length else "{}"
      payload = json.loads(body)
      content = generator.generate(payload)
      self.send_json({"content": content})
    except Exception as exc:
      self.send_json({"error": str(exc)}, status=500)

  def serve_static(self, path: str):
    if path in ("", "/"):
      path = "/index.html"
    requested = (ROOT / path.lstrip("/")).resolve()
    if not str(requested).startswith(str(ROOT)) or not requested.exists() or not requested.is_file():
      self.send_json({"error": "Not found"}, status=404)
      return

    content_type = {
      ".html": "text/html; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json; charset=utf-8"
    }.get(requested.suffix, "text/plain; charset=utf-8")

    self.send_response(200)
    self.send_header("Content-Type", content_type)
    self.end_headers()
    self.wfile.write(requested.read_bytes())

  def send_json(self, payload: Dict[str, Any], status: int = 200):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    self.send_response(status)
    self.send_header("Content-Type", "application/json; charset=utf-8")
    self.send_header("Content-Length", str(len(body)))
    self.end_headers()
    self.wfile.write(body)

  def log_message(self, format: str, *args):
    return


def main():
  try:
    server = ThreadingHTTPServer((HOST, PORT), HotFlowHandler)
  except OSError as exc:
    if exc.errno == 48:
      print(
        f"Port {PORT} is already in use. "
        f"Run with a different port, for example: HOTFLOW_PORT=8001 python3 server.py"
      )
      return
    raise

  print(f"HotFlow running at http://{HOST}:{PORT}")
  try:
    server.serve_forever()
  except KeyboardInterrupt:
    print("\nHotFlow stopped.")


if __name__ == "__main__":
  main()
