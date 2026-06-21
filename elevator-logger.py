#!/usr/bin/env python3
"""
电梯仿真日志服务器
接收浏览器 POST /log，以 JSON Lines 格式写入 elevator.log

运行方式：
    python3 elevator-logger.py

日志格式（每行一条 JSON）：
    {"_ts":"ISO时间","_rel":相对秒数,"t":"事件大类","ev":"具体事件",...字段}

事件大类：
    sys   - 系统启动/重置
    elev  - 电梯状态机（call/arr/dopen/dcls/imv）
    pax   - 乘客生命周期（spawn/dispatch/board/arrive）
    opt   - 智能优化器运行结果
    stat  - 定期系统快照（每5秒）
"""
from http.server import BaseHTTPRequestHandler, HTTPServer
import json, os, sys
from datetime import datetime

LOG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'elevator.log')
PORT = 8766


class LogHandler(BaseHTTPRequestHandler):
    total_entries = 0

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def do_POST(self):
        if self.path != '/log':
            self.send_response(404)
            self.end_headers()
            return
        try:
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            payload = json.loads(body)
            entries = payload.get('batch', [])
            with open(LOG_FILE, 'a', encoding='utf-8') as f:
                for e in entries:
                    f.write(json.dumps(e, ensure_ascii=False) + '\n')
            LogHandler.total_entries += len(entries)
            size_kb = os.path.getsize(LOG_FILE) / 1024
            ts = datetime.now().strftime('%H:%M:%S')
            print(f'[{ts}] +{len(entries):3d} entries  total={LogHandler.total_entries}  size={size_kb:.1f}KB  → {os.path.basename(LOG_FILE)}')
            self.send_response(200)
            self._cors_headers()
            self.send_header('Content-Type', 'text/plain')
            self.end_headers()
            self.wfile.write(f'ok {len(entries)}\n'.encode())
        except Exception as ex:
            self.send_response(500)
            self._cors_headers()
            self.end_headers()
            self.wfile.write(str(ex).encode())

    def _cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def log_message(self, fmt, *args):
        pass  # 屏蔽 BaseHTTPServer 默认输出


if __name__ == '__main__':
    # 写入日志头
    with open(LOG_FILE, 'a', encoding='utf-8') as f:
        f.write(json.dumps({
            '_ts': datetime.now().isoformat(),
            '_rel': 0,
            't': 'meta',
            'ev': 'logger_start',
            'log_file': LOG_FILE
        }, ensure_ascii=False) + '\n')

    print('=' * 55)
    print(f'  电梯仿真日志服务器  port={PORT}')
    print(f'  日志文件: {LOG_FILE}')
    print('  Ctrl+C 停止')
    print('=' * 55)
    try:
        HTTPServer(('localhost', PORT), LogHandler).serve_forever()
    except KeyboardInterrupt:
        print(f'\n已停止，共写入 {LogHandler.total_entries} 条记录。')
        sys.exit(0)
