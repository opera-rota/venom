using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace Venom
{
    public sealed class Picture
    {
        public string Data { get; internal set; }
        public int Width { get; internal set; }
        public int Height { get; internal set; }
    }

    public sealed class Sandboxed : IDisposable
    {
        private IntPtr job;
        private IntPtr process;
        private readonly int id;

        internal Sandboxed(IntPtr job, IntPtr process, int id)
        {
            this.job = job;
            this.process = process;
            this.id = id;
        }

        public int Id { get { return id; } }

        public bool WaitExit(int milliseconds)
        {
            return Native.WaitForSingleObject(process, (uint)milliseconds) == 0;
        }

        public int ExitCode
        {
            get
            {
                uint code;
                Native.GetExitCodeProcess(process, out code);
                return unchecked((int)code);
            }
        }

        public void Kill()
        {
            if (job != IntPtr.Zero)
            {
                Native.TerminateJobObject(job, 1);
            }
        }

        public void Dispose()
        {
            if (process != IntPtr.Zero)
            {
                Native.CloseHandle(process);
                process = IntPtr.Zero;
            }
            if (job != IntPtr.Zero)
            {
                Native.CloseHandle(job);
                job = IntPtr.Zero;
            }
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct Rect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct ScreenPoint
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct MouseInput
    {
        public int Dx;
        public int Dy;
        public uint MouseData;
        public uint Flags;
        public uint Time;
        public IntPtr ExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct KeyboardInput
    {
        public ushort VirtualKey;
        public ushort Scan;
        public uint Flags;
        public uint Time;
        public IntPtr ExtraInfo;
    }

    [StructLayout(LayoutKind.Explicit)]
    internal struct InputUnion
    {
        [FieldOffset(0)] public MouseInput Mouse;
        [FieldOffset(0)] public KeyboardInput Keyboard;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct Input
    {
        public uint Type;
        public InputUnion Data;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct SidAndAttributes
    {
        public IntPtr Sid;
        public uint Attributes;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct TokenMandatoryLabel
    {
        public SidAndAttributes Label;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    internal struct StartupInfo
    {
        public int Size;
        public string Reserved;
        public string Desktop;
        public string Title;
        public int X;
        public int Y;
        public int Width;
        public int Height;
        public int CountCharsX;
        public int CountCharsY;
        public int FillAttribute;
        public int Flags;
        public short ShowWindow;
        public short Reserved2Size;
        public IntPtr Reserved2;
        public IntPtr StdInput;
        public IntPtr StdOutput;
        public IntPtr StdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct ProcessInformation
    {
        public IntPtr Process;
        public IntPtr Thread;
        public int ProcessId;
        public int ThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct JobBasicLimits
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct IoCounters
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct JobExtendedLimits
    {
        public JobBasicLimits Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    internal delegate bool EnumWindowsProc(IntPtr window, IntPtr data);

    internal static class Native
    {
        [DllImport("user32.dll")] internal static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] internal static extern IntPtr GetAncestor(IntPtr window, uint flags);
        [DllImport("user32.dll")] internal static extern bool IsWindow(IntPtr window);
        [DllImport("user32.dll")] internal static extern bool IsIconic(IntPtr window);
        [DllImport("user32.dll")] internal static extern bool ShowWindow(IntPtr window, int command);
        [DllImport("user32.dll")] internal static extern bool SetForegroundWindow(IntPtr window);
        [DllImport("user32.dll")] internal static extern bool BringWindowToTop(IntPtr window);
        [DllImport("user32.dll")] internal static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
        [DllImport("user32.dll")] internal static extern bool AttachThreadInput(uint from, uint to, bool attach);
        [DllImport("user32.dll")] internal static extern IntPtr WindowFromPoint(ScreenPoint point);
        [DllImport("user32.dll")] internal static extern bool SetCursorPos(int x, int y);
        [DllImport("user32.dll")] internal static extern bool GetWindowRect(IntPtr window, out Rect rect);
        [DllImport("user32.dll")] internal static extern int GetSystemMetrics(int index);
        [DllImport("user32.dll")] internal static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
        [DllImport("user32.dll")] internal static extern bool EnumChildWindows(IntPtr parent, EnumWindowsProc callback, IntPtr data);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern int GetClassName(IntPtr window, StringBuilder name, int size);
        [DllImport("user32.dll", SetLastError = true)] internal static extern uint SendInput(uint count, Input[] inputs, int size);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern short VkKeyScanEx(char character, IntPtr layout);
        [DllImport("user32.dll")] internal static extern IntPtr GetKeyboardLayout(uint thread);
        [DllImport("user32.dll")] internal static extern uint MapVirtualKeyEx(uint code, uint mapType, IntPtr layout);
        [DllImport("user32.dll")] internal static extern short GetKeyState(int key);
        [DllImport("user32.dll")] internal static extern bool SetProcessDpiAwarenessContext(IntPtr context);
        [DllImport("user32.dll")] internal static extern bool SetProcessDPIAware();
        [DllImport("dwmapi.dll")] internal static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out Rect rect, int size);
        [DllImport("kernel32.dll")] internal static extern uint GetCurrentThreadId();
        [DllImport("kernel32.dll")] internal static extern IntPtr GetCurrentProcess();
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool CloseHandle(IntPtr handle);
        [DllImport("kernel32.dll")] internal static extern IntPtr LocalFree(IntPtr memory);
        [DllImport("kernel32.dll")] internal static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
        [DllImport("kernel32.dll")] internal static extern bool GetExitCodeProcess(IntPtr process, out uint code);
        [DllImport("kernel32.dll")] internal static extern uint ResumeThread(IntPtr thread);
        [DllImport("kernel32.dll")] internal static extern bool TerminateProcess(IntPtr process, uint code);
        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] internal static extern IntPtr CreateJobObject(IntPtr attributes, string name);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref JobExtendedLimits info, uint size);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
        [DllImport("kernel32.dll")] internal static extern bool TerminateJobObject(IntPtr job, uint code);
        [DllImport("advapi32.dll", SetLastError = true)] internal static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
        [DllImport("advapi32.dll", SetLastError = true)] internal static extern bool DuplicateTokenEx(IntPtr token, uint access, IntPtr attributes, int level, int type, out IntPtr duplicate);
        [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] internal static extern bool ConvertStringSidToSid(string text, out IntPtr sid);
        [DllImport("advapi32.dll")] internal static extern int GetLengthSid(IntPtr sid);
        [DllImport("advapi32.dll", SetLastError = true)] internal static extern bool SetTokenInformation(IntPtr token, int infoClass, ref TokenMandatoryLabel info, uint size);
        [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode, EntryPoint = "CreateProcessAsUserW")]
        internal static extern bool CreateProcessAsUser(IntPtr token, string application, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string directory, ref StartupInfo startup, out ProcessInformation information);
    }

    public static class Hands
    {
        private const uint RootAncestor = 2;
        private const uint KeyboardType = 1;
        private const uint MouseType = 0;
        private const uint KeyUp = 0x2;
        private const uint KeyUnicode = 0x4;
        private const uint MouseLeftDown = 0x2;
        private const uint MouseLeftUp = 0x4;
        private const uint MouseWheel = 0x800;
        private const uint ExtendedKey = 0x1;
        private const ushort ReturnKey = 0x0D;
        private const ushort TabKey = 0x09;
        private const ushort AltKey = 0x12;
        private const ushort ShiftKey = 0x10;
        private const ushort ControlKey = 0x11;
        private const int CapsLockKey = 0x14;
        private const uint VirtualToScan = 0;
        private const uint VirtualToCharacter = 2;
        private const int ModifierPause = 30;

        public static void Init()
        {
            try
            {
                if (!Native.SetProcessDpiAwarenessContext(new IntPtr(-4)))
                {
                    Native.SetProcessDPIAware();
                }
            }
            catch (EntryPointNotFoundException)
            {
                Native.SetProcessDPIAware();
            }
        }

        private static IntPtr Root(IntPtr window)
        {
            return window == IntPtr.Zero ? IntPtr.Zero : Native.GetAncestor(window, RootAncestor);
        }

        public static long Foreground()
        {
            return Root(Native.GetForegroundWindow()).ToInt64();
        }

        public static bool Exists(long window)
        {
            return Native.IsWindow(new IntPtr(window));
        }

        public static bool Focus(long window)
        {
            IntPtr target = new IntPtr(window);
            if (!Native.IsWindow(target))
            {
                return false;
            }
            if (Native.IsIconic(target))
            {
                Native.ShowWindow(target, 9);
            }
            for (int attempt = 0; attempt < 4; attempt++)
            {
                if (Root(Native.GetForegroundWindow()) == target)
                {
                    return true;
                }
                if (attempt > 1)
                {
                    SendKey(AltKey);
                }
                IntPtr front = Native.GetForegroundWindow();
                uint ignored;
                uint frontThread = Native.GetWindowThreadProcessId(front, out ignored);
                uint self = Native.GetCurrentThreadId();
                bool attached = frontThread != 0 && frontThread != self && Native.AttachThreadInput(self, frontThread, true);
                try
                {
                    Native.BringWindowToTop(target);
                    Native.SetForegroundWindow(target);
                }
                finally
                {
                    if (attached)
                    {
                        Native.AttachThreadInput(self, frontThread, false);
                    }
                }
                Thread.Sleep(150);
            }
            return Root(Native.GetForegroundWindow()) == target;
        }

        public static int Type(long window, string text, int delay)
        {
            IntPtr target = new IntPtr(window);
            uint process;
            IntPtr layout = Native.GetKeyboardLayout(Native.GetWindowThreadProcessId(target, out process));
            for (int index = 0; index < text.Length; index++)
            {
                if (Root(Native.GetForegroundWindow()) != target)
                {
                    return index;
                }
                char next = text[index];
                if (next == '\r')
                {
                    continue;
                }
                if (next == '\n')
                {
                    SendKey(ReturnKey);
                }
                else if (next == '\t')
                {
                    SendKey(TabKey);
                }
                else
                {
                    SendCharacter(next, layout, target);
                }
                Settle(target);
                if (next == '\n' || next == '\t')
                {
                    Thread.Sleep(Math.Max(delay, 60));
                    Settle(target);
                }
                else if (delay > 0)
                {
                    Thread.Sleep(delay);
                }
            }
            return text.Length;
        }

        private static void Settle(IntPtr target)
        {
            IntPtr ignored;
            Native.SendMessageTimeout(target, 0, IntPtr.Zero, IntPtr.Zero, 0x2, 2000, out ignored);
        }

        public static bool ClickAt(long window, int x, int y)
        {
            IntPtr target = new IntPtr(window);
            ScreenPoint point = new ScreenPoint();
            point.X = x;
            point.Y = y;
            if (Root(Native.WindowFromPoint(point)) != target || Root(Native.GetForegroundWindow()) != target)
            {
                return false;
            }
            Native.SetCursorPos(x, y);
            Thread.Sleep(40);
            Input[] inputs = new Input[2];
            inputs[0].Type = MouseType;
            inputs[0].Data.Mouse.Flags = MouseLeftDown;
            inputs[1].Type = MouseType;
            inputs[1].Data.Mouse.Flags = MouseLeftUp;
            return Native.SendInput(2, inputs, Marshal.SizeOf(typeof(Input))) == 2;
        }

        public static string Capture(long window, string path)
        {
            Rect bounds;
            if (window == 0)
            {
                bounds.Left = Native.GetSystemMetrics(76);
                bounds.Top = Native.GetSystemMetrics(77);
                bounds.Right = bounds.Left + Native.GetSystemMetrics(78);
                bounds.Bottom = bounds.Top + Native.GetSystemMetrics(79);
            }
            else
            {
                IntPtr target = new IntPtr(window);
                if (Native.DwmGetWindowAttribute(target, 9, out bounds, Marshal.SizeOf(typeof(Rect))) != 0)
                {
                    Native.GetWindowRect(target, out bounds);
                }
            }
            int width = Math.Max(1, bounds.Right - bounds.Left);
            int height = Math.Max(1, bounds.Bottom - bounds.Top);
            using (Bitmap image = new Bitmap(width, height, PixelFormat.Format32bppArgb))
            {
                using (Graphics canvas = Graphics.FromImage(image))
                {
                    canvas.CopyFromScreen(bounds.Left, bounds.Top, 0, 0, new Size(width, height), CopyPixelOperation.SourceCopy);
                }
                image.Save(path, ImageFormat.Png);
            }
            return width + "x" + height;
        }

        public static bool ClickTimes(long window, int x, int y, int times)
        {
            IntPtr target = new IntPtr(window);
            if (!Inside(target, x, y))
            {
                return false;
            }
            Native.SetCursorPos(x, y);
            Thread.Sleep(40);
            for (int round = 0; round < times; round++)
            {
                Input[] inputs = new Input[2];
                inputs[0].Type = MouseType;
                inputs[0].Data.Mouse.Flags = MouseLeftDown;
                inputs[1].Type = MouseType;
                inputs[1].Data.Mouse.Flags = MouseLeftUp;
                if (Native.SendInput(2, inputs, Marshal.SizeOf(typeof(Input))) != 2)
                {
                    return false;
                }
                Thread.Sleep(60);
            }
            return true;
        }

        public static bool Wheel(long window, int x, int y, int notches)
        {
            IntPtr target = new IntPtr(window);
            if (!Inside(target, x, y))
            {
                return false;
            }
            Native.SetCursorPos(x, y);
            Thread.Sleep(40);
            int direction = notches < 0 ? -1 : 1;
            for (int step = 0; step < Math.Abs(notches); step++)
            {
                Input[] inputs = new Input[1];
                inputs[0].Type = MouseType;
                inputs[0].Data.Mouse.Flags = MouseWheel;
                inputs[0].Data.Mouse.MouseData = unchecked((uint)(direction * 120));
                Native.SendInput(1, inputs, Marshal.SizeOf(typeof(Input)));
                Thread.Sleep(90);
            }
            return true;
        }

        public static int[] Center(long window)
        {
            IntPtr target = new IntPtr(window);
            Rect bounds;
            if (Native.DwmGetWindowAttribute(target, 9, out bounds, Marshal.SizeOf(typeof(Rect))) != 0)
            {
                Native.GetWindowRect(target, out bounds);
            }
            return new int[] { (bounds.Left + bounds.Right) / 2, (bounds.Top + bounds.Bottom) / 2 };
        }

        public static bool Chord(long window, int[] keys)
        {
            IntPtr target = new IntPtr(window);
            if (Root(Native.GetForegroundWindow()) != target)
            {
                return false;
            }
            uint process;
            IntPtr layout = Native.GetKeyboardLayout(Native.GetWindowThreadProcessId(target, out process));
            for (int index = 0; index < keys.Length; index++)
            {
                Send(new Input[] { ChordStroke((ushort)keys[index], false, layout) });
                Settle(target);
                Thread.Sleep(ModifierPause);
            }
            for (int index = keys.Length - 1; index >= 0; index--)
            {
                Send(new Input[] { ChordStroke((ushort)keys[index], true, layout) });
                Thread.Sleep(ModifierPause);
            }
            Settle(target);
            return true;
        }

        private static Input ChordStroke(ushort key, bool up, IntPtr layout)
        {
            Input input = KeyStroke(key, up, layout);
            if ((key >= 0x21 && key <= 0x28) || key == 0x2D || key == 0x2E || key == 0x5B)
            {
                input.Data.Keyboard.Flags |= ExtendedKey;
            }
            return input;
        }

        private static bool Inside(IntPtr target, int x, int y)
        {
            ScreenPoint point = new ScreenPoint();
            point.X = x;
            point.Y = y;
            return Root(Native.WindowFromPoint(point)) == target && Root(Native.GetForegroundWindow()) == target;
        }

        public static int WakePages(long window)
        {
            List<IntPtr> pages = new List<IntPtr>();
            StringBuilder name = new StringBuilder(64);
            Native.EnumChildWindows(new IntPtr(window), (child, data) =>
            {
                name.Length = 0;
                if (Native.GetClassName(child, name, name.Capacity) > 0 && name.ToString() == "Chrome_RenderWidgetHostHWND")
                {
                    pages.Add(child);
                }
                return true;
            }, IntPtr.Zero);
            foreach (IntPtr page in pages)
            {
                IntPtr ignored;
                Native.SendMessageTimeout(page, 0x003D, IntPtr.Zero, new IntPtr(1), 0x2, 1000, out ignored);
            }
            return pages.Count;
        }

        public static int[] Screen()
        {
            return new int[] { Native.GetSystemMetrics(0), Native.GetSystemMetrics(1) };
        }

        public static Picture Look(int width, int height, int[] boxes, int limit)
        {
            int screenWidth = Math.Max(1, Native.GetSystemMetrics(0));
            int screenHeight = Math.Max(1, Native.GetSystemMetrics(1));
            using (Bitmap screen = new Bitmap(screenWidth, screenHeight, PixelFormat.Format32bppArgb))
            using (Bitmap picture = new Bitmap(width, height, PixelFormat.Format24bppRgb))
            {
                using (Graphics canvas = Graphics.FromImage(screen))
                {
                    canvas.CopyFromScreen(0, 0, 0, 0, new Size(screenWidth, screenHeight), CopyPixelOperation.SourceCopy);
                }
                using (Graphics canvas = Graphics.FromImage(picture))
                {
                    canvas.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    canvas.PixelOffsetMode = PixelOffsetMode.HighQuality;
                    canvas.DrawImage(screen, new Rectangle(0, 0, width, height));
                    DrawMarks(canvas, boxes, width, height);
                }
                Picture result = new Picture();
                result.Data = Encode(picture, limit);
                result.Width = width;
                result.Height = height;
                return result;
            }
        }

        private static void DrawMarks(Graphics canvas, int[] boxes, int width, int height)
        {
            if (boxes == null)
            {
                return;
            }
            Color tone = Color.FromArgb(255, 229, 32, 64);
            canvas.SmoothingMode = SmoothingMode.None;
            canvas.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
            using (Pen pen = new Pen(tone, 2f))
            using (SolidBrush fill = new SolidBrush(tone))
            using (SolidBrush ink = new SolidBrush(Color.White))
            using (Font font = new Font("Segoe UI", 13f, FontStyle.Bold, GraphicsUnit.Pixel))
            {
                for (int index = 0; index + 3 < boxes.Length; index += 4)
                {
                    Rectangle box = new Rectangle(boxes[index], boxes[index + 1], Math.Max(2, boxes[index + 2]), Math.Max(2, boxes[index + 3]));
                    canvas.DrawRectangle(pen, box);
                    string label = ((index / 4) + 1).ToString();
                    SizeF size = canvas.MeasureString(label, font);
                    int labelWidth = (int)Math.Ceiling(size.Width) + 4;
                    int labelHeight = (int)Math.Ceiling(size.Height);
                    int x = Math.Max(0, Math.Min(box.Left, width - labelWidth));
                    int y = box.Top - labelHeight >= 0 ? box.Top - labelHeight : Math.Min(box.Top, height - labelHeight);
                    canvas.FillRectangle(fill, x, y, labelWidth, labelHeight);
                    canvas.DrawString(label, font, ink, x + 2, y);
                }
            }
        }

        private static string Encode(Bitmap picture, int limit)
        {
            ImageCodecInfo jpeg = Array.Find(ImageCodecInfo.GetImageEncoders(), codec => codec.FormatID == ImageFormat.Jpeg.Guid);
            string data = string.Empty;
            foreach (long quality in new long[] { 72, 56, 40, 28 })
            {
                using (MemoryStream stream = new MemoryStream())
                using (EncoderParameters settings = new EncoderParameters(1))
                {
                    settings.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, quality);
                    picture.Save(stream, jpeg, settings);
                    data = Convert.ToBase64String(stream.ToArray());
                }
                if (data.Length <= limit)
                {
                    break;
                }
            }
            return data;
        }

        public static bool SandboxReady()
        {
            try
            {
                Native.CloseHandle(LowToken());
                return true;
            }
            catch (Win32Exception)
            {
                return false;
            }
        }

        public static Sandboxed StartLow(string commandLine, string directory, string environment)
        {
            IntPtr token = LowToken();
            IntPtr job = IntPtr.Zero;
            IntPtr block = Marshal.StringToHGlobalUni(environment);
            ProcessInformation started = new ProcessInformation();
            bool running = false;
            try
            {
                job = Native.CreateJobObject(IntPtr.Zero, null);
                if (job == IntPtr.Zero)
                {
                    throw Failure("create the script's job");
                }
                JobExtendedLimits limits = new JobExtendedLimits();
                limits.Basic.LimitFlags = 0x2000 | 0x400 | 0x200 | 0x8;
                limits.Basic.ActiveProcessLimit = 32;
                limits.JobMemoryLimit = new UIntPtr(2UL * 1024 * 1024 * 1024);
                if (!Native.SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(JobExtendedLimits))))
                {
                    throw Failure("limit the script's job");
                }
                StartupInfo startup = new StartupInfo();
                startup.Size = Marshal.SizeOf(typeof(StartupInfo));
                startup.Flags = 0x1;
                startup.ShowWindow = 0;
                StringBuilder line = new StringBuilder(commandLine, commandLine.Length + 1);
                if (!Native.CreateProcessAsUser(token, null, line, IntPtr.Zero, IntPtr.Zero, false, 0x4 | 0x400 | 0x08000000, block, directory, ref startup, out started))
                {
                    throw Failure("start the script at low integrity");
                }
                running = true;
                if (!Native.AssignProcessToJobObject(job, started.Process))
                {
                    throw Failure("put the script in its job");
                }
                Native.ResumeThread(started.Thread);
                Native.CloseHandle(started.Thread);
                Sandboxed result = new Sandboxed(job, started.Process, started.ProcessId);
                job = IntPtr.Zero;
                running = false;
                return result;
            }
            finally
            {
                if (running)
                {
                    Native.TerminateProcess(started.Process, 1);
                    Native.CloseHandle(started.Thread);
                    Native.CloseHandle(started.Process);
                }
                if (job != IntPtr.Zero)
                {
                    Native.CloseHandle(job);
                }
                Marshal.FreeHGlobal(block);
                Native.CloseHandle(token);
            }
        }

        private static IntPtr LowToken()
        {
            IntPtr token;
            if (!Native.OpenProcessToken(Native.GetCurrentProcess(), 0x1 | 0x2 | 0x8 | 0x80, out token))
            {
                throw Failure("open this process's token");
            }
            IntPtr low = IntPtr.Zero;
            IntPtr sid = IntPtr.Zero;
            try
            {
                if (!Native.DuplicateTokenEx(token, 0x02000000, IntPtr.Zero, 2, 1, out low))
                {
                    throw Failure("copy this process's token");
                }
                if (!Native.ConvertStringSidToSid("S-1-16-4096", out sid))
                {
                    throw Failure("name the low integrity level");
                }
                TokenMandatoryLabel label = new TokenMandatoryLabel();
                label.Label.Sid = sid;
                label.Label.Attributes = 0x20;
                uint size = (uint)(Marshal.SizeOf(typeof(TokenMandatoryLabel)) + Native.GetLengthSid(sid));
                if (!Native.SetTokenInformation(low, 25, ref label, size))
                {
                    throw Failure("lower the token's integrity");
                }
                IntPtr result = low;
                low = IntPtr.Zero;
                return result;
            }
            finally
            {
                Native.CloseHandle(token);
                if (low != IntPtr.Zero)
                {
                    Native.CloseHandle(low);
                }
                if (sid != IntPtr.Zero)
                {
                    Native.LocalFree(sid);
                }
            }
        }

        private static Win32Exception Failure(string what)
        {
            int code = Marshal.GetLastWin32Error();
            return new Win32Exception(code, "Windows would not let VENOM " + what + " (error " + code + ").");
        }

        private static void SendKey(ushort key)
        {
            Input[] inputs = new Input[2];
            inputs[0].Type = KeyboardType;
            inputs[0].Data.Keyboard.VirtualKey = key;
            inputs[1].Type = KeyboardType;
            inputs[1].Data.Keyboard.VirtualKey = key;
            inputs[1].Data.Keyboard.Flags = KeyUp;
            Native.SendInput(2, inputs, Marshal.SizeOf(typeof(Input)));
        }

        private static void SendCharacter(char character, IntPtr layout, IntPtr target)
        {
            short mapped = Native.VkKeyScanEx(character, layout);
            int key = mapped & 0xFF;
            int state = (mapped >> 8) & 0xFF;
            if (!OnKeyboard(mapped, layout))
            {
                SendUnicode(character);
                return;
            }
            bool shift = (state & 0x1) != 0;
            if (char.IsLetter(character) && (Native.GetKeyState(CapsLockKey) & 0x1) != 0)
            {
                shift = !shift;
            }
            List<ushort> held = new List<ushort>();
            if (shift)
            {
                held.Add(ShiftKey);
            }
            if ((state & 0x6) == 0x6)
            {
                held.Add(ControlKey);
                held.Add(AltKey);
            }
            Input[] press = { KeyStroke((ushort)key, false, layout), KeyStroke((ushort)key, true, layout) };
            if (held.Count == 0)
            {
                Send(press);
                return;
            }
            Send(held.ConvertAll(modifier => KeyStroke(modifier, false, layout)).ToArray());
            Settle(target);
            Thread.Sleep(ModifierPause);
            Send(press);
            Settle(target);
            Thread.Sleep(ModifierPause);
            List<Input> release = held.ConvertAll(modifier => KeyStroke(modifier, true, layout));
            release.Reverse();
            Send(release.ToArray());
        }

        private static void Send(Input[] inputs)
        {
            Native.SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(Input)));
        }

        private static bool OnKeyboard(short mapped, IntPtr layout)
        {
            if (mapped == -1)
            {
                return false;
            }
            int key = mapped & 0xFF;
            int state = (mapped >> 8) & 0xFF;
            bool plainModifiers = (state & ~0x7) == 0;
            bool shortcutOnly = (state & 0x6) == 0x2 || (state & 0x6) == 0x4;
            bool deadKey = (Native.MapVirtualKeyEx((uint)key, VirtualToCharacter, layout) & 0x80000000) != 0;
            return key != 0xFF && plainModifiers && !shortcutOnly && !deadKey;
        }

        private static Input KeyStroke(ushort key, bool up, IntPtr layout)
        {
            Input input = new Input();
            input.Type = KeyboardType;
            input.Data.Keyboard.VirtualKey = key;
            input.Data.Keyboard.Scan = (ushort)Native.MapVirtualKeyEx(key, VirtualToScan, layout);
            input.Data.Keyboard.Flags = up ? KeyUp : 0;
            return input;
        }

        private static void SendUnicode(char character)
        {
            Input[] inputs = new Input[2];
            inputs[0].Type = KeyboardType;
            inputs[0].Data.Keyboard.Scan = character;
            inputs[0].Data.Keyboard.Flags = KeyUnicode;
            inputs[1].Type = KeyboardType;
            inputs[1].Data.Keyboard.Scan = character;
            inputs[1].Data.Keyboard.Flags = KeyUnicode | KeyUp;
            Native.SendInput(2, inputs, Marshal.SizeOf(typeof(Input)));
        }
    }
}
