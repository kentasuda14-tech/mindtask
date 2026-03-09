#!/usr/bin/env python3
"""
Notion タスク管理スクリプト（REST API直接使用）
"""

import os
import requests
from dotenv import load_dotenv
from datetime import datetime, timedelta
import json

# .envファイルから環境変数を読み込み
load_dotenv()

NOTION_API_KEY = os.environ["NOTION_API_KEY"]
DATABASE_ID = os.environ["NOTION_DATABASE_ID"]

HEADERS = {
    "Authorization": f"Bearer {NOTION_API_KEY}",
    "Content-Type": "application/json",
    "Notion-Version": "2022-06-28"
}


def get_all_tasks():
    """全てのタスクを取得"""
    url = f"https://api.notion.com/v1/databases/{DATABASE_ID}/query"

    try:
        response = requests.post(url, headers=HEADERS)
        response.raise_for_status()
        data = response.json()

        tasks = []
        for page in data.get("results", []):
            task = parse_task(page)
            tasks.append(task)

        return tasks
    except Exception as e:
        print(f"エラー: {e}")
        return []


def get_urgent_tasks():
    """緊急タスク（🔴）を取得"""
    url = f"https://api.notion.com/v1/databases/{DATABASE_ID}/query"

    payload = {
        "filter": {
            "property": "優先度",
            "select": {
                "equals": "🔴緊急"
            }
        }
    }

    try:
        response = requests.post(url, headers=HEADERS, json=payload)
        response.raise_for_status()
        data = response.json()

        tasks = []
        for page in data.get("results", []):
            task = parse_task(page)
            tasks.append(task)

        return tasks
    except Exception as e:
        print(f"エラー: {e}")
        return []


def get_tasks_by_status(status="未着手"):
    """ステータスでフィルタリング"""
    url = f"https://api.notion.com/v1/databases/{DATABASE_ID}/query"

    payload = {
        "filter": {
            "property": "ステータス",
            "status": {
                "equals": status
            }
        }
    }

    try:
        response = requests.post(url, headers=HEADERS, json=payload)
        response.raise_for_status()
        data = response.json()

        tasks = []
        for page in data.get("results", []):
            task = parse_task(page)
            tasks.append(task)

        return tasks
    except Exception as e:
        print(f"エラー: {e}")
        return []


def parse_task(page):
    """Notionページからタスク情報を抽出"""
    properties = page.get("properties", {})

    # タスク名
    title_property = properties.get("タスク名", {})
    title = ""
    if title_property.get("title"):
        title = title_property["title"][0]["plain_text"]

    # 優先度
    priority_property = properties.get("優先度", {})
    priority = ""
    if priority_property.get("select"):
        priority = priority_property["select"].get("name", "")

    # 期限
    deadline_property = properties.get("期限", {})
    deadline = None
    if deadline_property.get("date"):
        deadline = deadline_property["date"].get("start")

    # ステータス
    status_property = properties.get("ステータス", {})
    status = ""
    if status_property.get("status"):
        status = status_property["status"].get("name", "未着手")

    # カテゴリ
    category_property = properties.get("カテゴリ", {})
    categories = []
    if category_property.get("multi_select"):
        categories = [c["name"] for c in category_property["multi_select"]]

    return {
        "id": page["id"],
        "タスク名": title,
        "優先度": priority,
        "期限": deadline,
        "ステータス": status,
        "カテゴリ": categories,
        "url": page.get("url", "")
    }


def add_task(title, priority="🟡重要", deadline=None, categories=None, memo=""):
    """新しいタスクを追加"""
    url = "https://api.notion.com/v1/pages"

    properties = {
        "タスク名": {
            "title": [
                {
                    "text": {
                        "content": title
                    }
                }
            ]
        },
        "優先度": {
            "select": {
                "name": priority
            }
        },
        "ステータス": {
            "status": {
                "name": "未着手"
            }
        }
    }

    # 期限を追加
    if deadline:
        properties["期限"] = {
            "date": {
                "start": deadline
            }
        }

    # カテゴリを追加
    if categories:
        properties["カテゴリ"] = {
            "multi_select": [{"name": cat} for cat in categories]
        }

    # メモを追加
    if memo:
        properties["メモ"] = {
            "rich_text": [
                {
                    "text": {
                        "content": memo
                    }
                }
            ]
        }

    payload = {
        "parent": {"database_id": DATABASE_ID},
        "properties": properties
    }

    try:
        response = requests.post(url, headers=HEADERS, json=payload)
        response.raise_for_status()
        print(f"✅ タスクを追加しました: {title}")
        return response.json()
    except Exception as e:
        print(f"エラー: {e}")
        if hasattr(e, 'response'):
            print(f"詳細: {e.response.text}")
        return None


def update_task_status(task_id, status):
    """タスクのステータスを更新"""
    url = f"https://api.notion.com/v1/pages/{task_id}"

    payload = {
        "properties": {
            "ステータス": {
                "status": {
                    "name": status
                }
            }
        }
    }

    try:
        response = requests.patch(url, headers=HEADERS, json=payload)
        response.raise_for_status()
        print(f"✅ ステータスを更新しました: {status}")
    except Exception as e:
        print(f"エラー: {e}")
        if hasattr(e, 'response'):
            print(f"詳細: {e.response.text}")


def print_tasks(tasks, title="タスク一覧"):
    """タスク一覧を表示"""
    print(f"\n{title}")
    print("=" * 60)

    if not tasks:
        print("タスクはありません")
        return

    for i, task in enumerate(tasks, 1):
        priority_emoji = task['優先度'] if task['優先度'] else "⚪️"
        print(f"\n{i}. 【{priority_emoji}】 {task['タスク名']}")
        if task['期限']:
            print(f"   期限: {task['期限']}")
        if task['カテゴリ']:
            print(f"   カテゴリ: {', '.join(task['カテゴリ'])}")
        if task['ステータス']:
            print(f"   ステータス: {task['ステータス']}")


if __name__ == "__main__":
    # 接続テスト
    print("✨ Notionに接続中...")

    # 全タスクを取得
    all_tasks = get_all_tasks()
    print_tasks(all_tasks, "\n📋 全タスク")

    # 緊急タスクを取得
    urgent_tasks = get_urgent_tasks()
    print_tasks(urgent_tasks, "\n🔴 緊急タスク")

    # 未着手タスクを取得
    todo_tasks = get_tasks_by_status("未着手")
    print_tasks(todo_tasks, "\n📝 未着手タスク")

    print("\n" + "=" * 60)
    print("✅ 接続成功！")
