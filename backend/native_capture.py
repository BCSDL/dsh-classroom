"""Optional Windows microphone recorder that is independent of the browser page."""
import ctypes
import os
import re
import subprocess
import threading
import time
import wave


def protect_child(process):
    """Windows closes this handle on worker exit, including abrupt worker termination."""
    from ctypes import wintypes
    class Basic(ctypes.Structure):
        _fields_ = [('PerProcessUserTimeLimit', ctypes.c_int64), ('PerJobUserTimeLimit', ctypes.c_int64),
                    ('LimitFlags', wintypes.DWORD), ('MinimumWorkingSetSize', ctypes.c_size_t),
                    ('MaximumWorkingSetSize', ctypes.c_size_t), ('ActiveProcessLimit', wintypes.DWORD),
                    ('Affinity', ctypes.c_size_t), ('PriorityClass', wintypes.DWORD), ('SchedulingClass', wintypes.DWORD)]
    class IO(ctypes.Structure):
        _fields_ = [(name, ctypes.c_uint64) for name in ['ReadOperationCount', 'WriteOperationCount', 'OtherOperationCount',
                                                       'ReadTransferCount', 'WriteTransferCount', 'OtherTransferCount']]
    class Extended(ctypes.Structure):
        _fields_ = [('BasicLimitInformation', Basic), ('IoInfo', IO), ('ProcessMemoryLimit', ctypes.c_size_t),
                    ('JobMemoryLimit', ctypes.c_size_t), ('PeakProcessMemoryUsed', ctypes.c_size_t), ('PeakJobMemoryUsed', ctypes.c_size_t)]
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.CreateJobObjectW.restype = wintypes.HANDLE
    kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.CreateJobObjectW(None, None)
    limits = Extended()
    limits.BasicLimitInformation.LimitFlags = 0x2000
    if not handle or not kernel.SetInformationJobObject(handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)) or not kernel.AssignProcessToJobObject(handle, int(process._handle)):
        if handle:
            kernel.CloseHandle(handle)
        raise RuntimeError('无法建立原生录音进程退出保护，请使用浏览器录音')
    return handle, kernel


class NativeCapture:
    def __init__(self, worker):
        self.w = worker
        self.active = {}

    def devices(self):
        if os.name != 'nt':
            return {'devices': [], 'reason': '原生录音目前支持 Windows DirectShow；仍可使用浏览器录音'}
        result = subprocess.run([self.w.FFMPEG, '-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'],
                                capture_output=True, timeout=20, creationflags=subprocess.CREATE_NO_WINDOW)
        text = result.stderr.decode('utf-8', errors='replace')
        return {'devices': list(dict.fromkeys(re.findall(r'"([^"\r\n]+)"\s*\(audio\)', text))),
                'reason': '选择本机输入设备；系统播放声音需要系统提供的相应采集设备'}

    def start(self, args):
        name = str(args.get('device', ''))
        if name not in self.devices()['devices']:
            raise ValueError('请选择当前枚举到的录音设备')
        if any(item['process'].poll() is None for item in self.active.values()):
            raise ValueError('已有原生录音在进行，请先结束它')
        w = self.w
        job = w.new_job('live', args)
        directory = w.job_dir(job['id'])
        error = (directory / 'capture-errors.log').open('wb')
        process = subprocess.Popen([w.FFMPEG, '-hide_banner', '-loglevel', 'error', '-f', 'dshow', '-i', 'audio=' + name,
                                    '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-f', 'segment',
                                    '-segment_time', '5', '-reset_timestamps', '1', str(directory / 'inputs' / 'native-%08d.wav')],
                                   stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=error,
                                   creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            handle, kernel = protect_child(process)
        except Exception:
            process.terminate()
            process.wait(timeout=10)
            error.close()
            w.update(job['id'], state='error', error='原生录音退出保护不可用')
            raise
        item = {'process': process, 'handle': handle, 'kernel': kernel, 'error': error, 'stopping': False}
        self.active[job['id']] = item
        w.update(job['id'], nativeCapture=True, phase='本机麦克风采集中；关闭网页不会停止录音')
        item['thread'] = threading.Thread(target=self.monitor, args=(job['id'], item), daemon=True)
        item['thread'].start()
        return w.public_job(w.read_job(job['id']))

    def monitor(self, identifier, item):
        w, index, offset = self.w, 0, 0.0
        directory = w.job_dir(identifier)
        try:
            while True:
                ended = item['process'].poll() is not None
                files = sorted((directory / 'inputs').glob('native-*.wav'))
                ready = files if ended else files[:-1]
                for source in ready[index:]:
                    with wave.open(str(source), 'rb') as audio:
                        duration = audio.getnframes() / audio.getframerate()
                    if duration:
                        w.dispatch('append', {'id': identifier, 'index': index, 'offset': offset, 'path': str(source)})
                    offset += duration
                    index += 1
                if ended:
                    break
                if w.read_job(identifier).get('cancelRequested'):
                    item['stopping'] = True
                    item['process'].stdin.write(b'q\n')
                    item['process'].stdin.flush()
                time.sleep(.3)
            if item['process'].returncode and not item['stopping']:
                raise RuntimeError((directory / 'capture-errors.log').read_text(encoding='utf-8', errors='replace')[-1500:])
            w.dispatch('finish', {'id': identifier})
            w.update(identifier, nativeCapture=False)
        except Exception as error:
            w.update(identifier, state='error', nativeCapture=False, error='本机录音异常；已完成片段保留。' + str(error))
            if item['process'].poll() is None:
                item['process'].terminate()
        finally:
            item['error'].close()
            item['kernel'].CloseHandle(item['handle'])

    def stop(self, identifier):
        item = self.active.get(identifier)
        if not item:
            raise ValueError('这条记录没有运行中的本机采集')
        if item['process'].poll() is None:
            item['stopping'] = True
            item['process'].stdin.write(b'q\n')
            item['process'].stdin.flush()
            item['process'].wait(timeout=15)
        item['thread'].join(timeout=15)
        return self.w.public_job(self.w.read_job(identifier))

    def close(self):
        for identifier, item in self.active.items():
            if item['process'].poll() is None:
                try:
                    self.stop(identifier)
                except Exception:
                    item['process'].terminate()
