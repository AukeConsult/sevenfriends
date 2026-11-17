using System.Threading;
using System.Windows;

namespace SevenFriends;

/// <summary>
/// One copy only: a second start asks the first one to show its window and ends.
/// Started with <c>--tray</c> (by Windows at sign-in) the window stays hidden and only the tray icon shows.
/// </summary>
public partial class App : Application
{
    private static Mutex? _only;
    private static EventWaitHandle? _show;

    protected override void OnStartup(StartupEventArgs e)
    {
        _only = new Mutex(true, "io.sevenfriends.app", out var first);
        _show = new EventWaitHandle(false, EventResetMode.AutoReset, "io.sevenfriends.app.show");
        if (!first)
        {
            _show.Set();
            Shutdown();
            return;
        }
        base.OnStartup(e);

        var window = new MainWindow(startHidden: e.Args.Contains("--tray"));
        MainWindow = window;
        window.Show(); // a window started hidden hides itself as soon as it is ready
        new Thread(() =>
        {
            while (_show.WaitOne()) Dispatcher.Invoke(window.ShowApp);
        }) { IsBackground = true }.Start();
    }
}
