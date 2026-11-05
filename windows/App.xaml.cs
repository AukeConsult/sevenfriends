using System.Runtime.InteropServices;
using System.Threading;
using System.Windows;

namespace SevenFriends;

/// <summary>One window only: a second start brings the first one forward and ends.</summary>
public partial class App : Application
{
    private static Mutex? _only;

    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr FindWindow(string? className, string title);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);

    protected override void OnStartup(StartupEventArgs e)
    {
        _only = new Mutex(true, "io.sevenfriends.app", out var first);
        if (!first)
        {
            var other = FindWindow(null, SevenFriends.MainWindow.WindowTitle);
            if (other != IntPtr.Zero)
            {
                ShowWindow(other, 9); // restore
                SetForegroundWindow(other);
            }
            Shutdown();
            return;
        }
        base.OnStartup(e);
    }
}
