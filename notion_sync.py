import os
from dotenv import load_dotenv

# ローカル実行時: 親ディレクトリの .env を読み込む（クラウドでは環境変数が直接設定される）
_parent_env = os.path.join(os.path.dirname(__file__), '..', '.env')
if os.path.exists(_parent_env):
    load_dotenv(_parent_env)
else:
    load_dotenv()  # カレントディレクトリの .env を読む（なければ無視）

import notion_tasks


def sync_tasks_to_notion(nodes):
    """
    マインドマップのノードからis_task=TrueのものをNotionに同期する

    引数:
        nodes: dict - ノードIDをキー、ノードデータを値とした辞書

    返り値:
        dict - {
            'nodes': 更新後のnodesオブジェクト,
            'created': 新規作成件数,
            'updated': 更新件数,
            'errors': エラーメッセージの配列
        }
    """
    created = 0
    updated = 0
    errors = []

    for node_id, node in nodes.items():
        if not node.get('is_task'):
            continue

        task = node.get('task', {})
        label = node.get('label', '（タスク名未設定）')
        priority = task.get('priority', '🟢通常')
        deadline = task.get('deadline')
        status = task.get('status', '未着手')
        notion_page_id = task.get('notion_page_id')

        try:
            if notion_page_id is None:
                # 新規作成
                result = notion_tasks.add_task(
                    title=label,
                    priority=priority,
                    deadline=deadline
                )
                if result:
                    node['task']['notion_page_id'] = result['id']
                    node['task']['notion_url'] = result.get('url', '')
                    created += 1
            else:
                # ステータス更新
                notion_tasks.update_task_status(
                    task_id=notion_page_id,
                    status=status
                )
                updated += 1
        except Exception as e:
            errors.append(f"{label}: {str(e)}")

    return {
        'nodes': nodes,
        'created': created,
        'updated': updated,
        'errors': errors
    }
