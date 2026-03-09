import json
import os
import re
from datetime import datetime
from flask import Flask, jsonify, request, render_template
from dotenv import load_dotenv

_parent_env = os.path.join(os.path.dirname(__file__), '..', '.env')
if os.path.exists(_parent_env):
    load_dotenv(_parent_env)
else:
    load_dotenv()

app = Flask(__name__)

_default_data_dir = os.path.join(os.path.dirname(__file__), 'data')
DATA_DIR = os.environ.get('DATA_DIR', _default_data_dir)
DOCS_FILE = os.path.join(DATA_DIR, 'documents.json')
OLD_MINDMAPS = os.path.join(DATA_DIR, 'mindmaps.json')

_id_counter = [0]


def gen_id():
    _id_counter[0] += 1
    return f"item_{int(datetime.now().timestamp() * 1000)}_{_id_counter[0]}"


# ===== 移行: 旧ノードツリー → items配列 =====

def node_tree_to_items(nodes, node_id, level=0):
    node = nodes.get(node_id)
    if not node:
        return []
    label = (node.get('label') or '').strip()
    is_task = node.get('is_task', False)
    task_data = node.get('task') or {}

    done = False
    deadline = None
    priority = None
    if is_task:
        done = task_data.get('status', '未着手') == '完了'
        deadline = task_data.get('deadline') or None
        p_str = task_data.get('priority', '')
        if '緊急' in p_str:
            priority = 'high'
        elif '重要' in p_str:
            priority = 'mid'
        elif '通常' in p_str or '低' in p_str:
            priority = 'low'

    items = [{
        'id': node_id,
        'text': label,
        'level': level,
        'isTask': is_task,
        'done': done,
        'deadline': deadline,
        'priority': priority,
    }]
    for child_id in node.get('children', []):
        items.extend(node_tree_to_items(nodes, child_id, level + 1))
    return items


# ===== 移行: Markdown文字列 → items配列 =====

def markdown_to_items(content):
    lines = content.split('\n')
    items = []
    for line in lines:
        trimmed = line.strip()
        if not trimmed:
            continue
        hm = re.match(r'^(#{1,3})\s+(.+)', trimmed)
        if hm:
            items.append({'id': gen_id(), 'text': hm.group(2).strip(),
                          'level': len(hm.group(1)) - 1, 'isTask': False,
                          'done': False, 'deadline': None, 'priority': None})
            continue
        tm = re.match(r'^(\s*)-\s+\[([xX ])\]\s+(.+)', line)
        if tm:
            rest = tm.group(3)
            dl = re.search(r'@(\d{4}-\d{2}-\d{2})', rest)
            pr = re.search(r'!(high|mid|low)', rest, re.I)
            text = re.sub(r'@\d{4}-\d{2}-\d{2}', '', rest)
            text = re.sub(r'!(high|mid|low)', '', text, flags=re.I).strip()
            items.append({'id': gen_id(), 'text': text,
                          'level': 3 + len(tm.group(1)) // 4,
                          'isTask': True, 'done': tm.group(2).lower() == 'x',
                          'deadline': dl.group(1) if dl else None,
                          'priority': pr.group(1).lower() if pr else None})
            continue
        bm = re.match(r'^(\s*)-\s+(.+)', line)
        if bm:
            items.append({'id': gen_id(), 'text': bm.group(2).strip(),
                          'level': 3 + len(bm.group(1)) // 4, 'isTask': False,
                          'done': False, 'deadline': None, 'priority': None})
    return items


# ===== データ読み書き =====

def load_docs():
    os.makedirs(DATA_DIR, exist_ok=True)

    if not os.path.exists(DOCS_FILE):
        # 旧 mindmaps.json から移行
        if os.path.exists(OLD_MINDMAPS):
            try:
                with open(OLD_MINDMAPS, 'r', encoding='utf-8') as f:
                    old = json.load(f)
                docs = {}
                for mm in old.get('mindmaps', []):
                    doc_id = mm.get('id', gen_id())
                    items = node_tree_to_items(mm.get('nodes', {}),
                                              mm.get('root_node_id', 'node_root'))
                    docs[doc_id] = {
                        'id': doc_id,
                        'title': mm.get('title', '無題'),
                        'items': items,
                        'created_at': mm.get('created_at', datetime.now().isoformat()),
                        'updated_at': mm.get('updated_at', datetime.now().isoformat()),
                    }
                if docs:
                    save_docs(docs)
                    return docs
            except Exception as e:
                print(f'旧データ移行エラー: {e}')

        # デフォルトドキュメント
        doc_id = 'doc_default'
        default = {doc_id: {
            'id': doc_id,
            'title': 'はじめてのメモ',
            'items': [
                {'id': 'i1', 'text': 'はじめてのメモ', 'level': 0,
                 'isTask': False, 'done': False, 'deadline': None, 'priority': None},
                {'id': 'i2', 'text': 'やること', 'level': 1,
                 'isTask': False, 'done': False, 'deadline': None, 'priority': None},
                {'id': 'i3', 'text': '最初のタスク', 'level': 2,
                 'isTask': True, 'done': False, 'deadline': '2026-04-01', 'priority': 'high'},
                {'id': 'i4', 'text': '2つ目のタスク', 'level': 2,
                 'isTask': True, 'done': False, 'deadline': '2026-04-15', 'priority': 'mid'},
                {'id': 'i5', 'text': 'メモとしてのアイテム', 'level': 2,
                 'isTask': False, 'done': False, 'deadline': None, 'priority': None},
                {'id': 'i6', 'text': 'アイデア', 'level': 1,
                 'isTask': False, 'done': False, 'deadline': None, 'priority': None},
                {'id': 'i7', 'text': 'ブレインストーミング用のスペース', 'level': 2,
                 'isTask': False, 'done': False, 'deadline': None, 'priority': None},
            ],
            'created_at': datetime.now().isoformat(),
            'updated_at': datetime.now().isoformat(),
        }}
        save_docs(default)
        return default

    with open(DOCS_FILE, 'r', encoding='utf-8') as f:
        docs = json.load(f)

    # 旧 content フォーマット（Markdown文字列）をitemsに変換
    changed = False
    for doc_id, doc in list(docs.items()):
        if 'content' in doc and 'items' not in doc:
            doc['items'] = markdown_to_items(doc.get('content', ''))
            del doc['content']
            changed = True
    if changed:
        save_docs(docs)

    return docs


def save_docs(docs):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(DOCS_FILE, 'w', encoding='utf-8') as f:
        json.dump(docs, f, ensure_ascii=False, indent=2)


# ===== API =====

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/docs', methods=['GET'])
def list_docs():
    docs = load_docs()
    result = [{'id': d['id'], 'title': d['title'], 'updated_at': d.get('updated_at', '')}
              for d in docs.values()]
    result.sort(key=lambda x: x['updated_at'], reverse=True)
    return jsonify(result)


@app.route('/api/docs', methods=['POST'])
def create_doc():
    docs = load_docs()
    body = request.get_json() or {}
    title = body.get('title', '新しいドキュメント')
    doc_id = f"doc_{int(datetime.now().timestamp() * 1000)}"
    now = datetime.now().isoformat()
    doc = {
        'id': doc_id,
        'title': title,
        'items': [{'id': gen_id(), 'text': title, 'level': 0,
                   'isTask': False, 'done': False, 'deadline': None, 'priority': None}],
        'created_at': now,
        'updated_at': now,
    }
    docs[doc_id] = doc
    save_docs(docs)
    return jsonify(doc), 201


@app.route('/api/docs/<doc_id>', methods=['GET'])
def get_doc(doc_id):
    docs = load_docs()
    if doc_id not in docs:
        return jsonify({'error': 'Not found'}), 404
    return jsonify(docs[doc_id])


@app.route('/api/docs/<doc_id>', methods=['PUT'])
def update_doc(doc_id):
    docs = load_docs()
    if doc_id not in docs:
        return jsonify({'error': 'Not found'}), 404
    body = request.get_json() or {}
    if 'items' in body:
        docs[doc_id]['items'] = body['items']
    if 'title' in body:
        docs[doc_id]['title'] = body['title']
    docs[doc_id]['updated_at'] = datetime.now().isoformat()
    save_docs(docs)
    return jsonify(docs[doc_id])


@app.route('/api/docs/<doc_id>', methods=['DELETE'])
def delete_doc(doc_id):
    docs = load_docs()
    if doc_id not in docs:
        return jsonify({'error': 'Not found'}), 404
    del docs[doc_id]
    save_docs(docs)
    return jsonify({'ok': True})


if __name__ == '__main__':
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        local_ip = s.getsockname()[0]
        s.close()
    except Exception:
        local_ip = '（取得できませんでした）'
    print("=" * 50)
    print("MindTask アプリを起動します")
    print("=" * 50)
    print(f"[PC]     http://localhost:5001")
    print(f"[スマホ]  http://{local_ip}:5001")
    print("=" * 50)
    app.run(debug=False, host='0.0.0.0', port=5001)
