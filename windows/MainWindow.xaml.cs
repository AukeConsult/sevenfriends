using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;

namespace SevenFriends;

/// <summary>
/// Shows the live web app (the same address as server.url in frontend/capacitor.config.json: change both together).
/// The web app stays the one code base: deploy it and this window shows the new version, nothing to rebuild.
///
/// Closing the window does not end the app: it goes to the tray (the icon next to the clock) and keeps running, so a
/// new message still arrives as a Windows notification. Only "Quit" in the tray menu ends it. "Start with Windows"
/// (also in the tray menu, and a choice in the installer) starts it hidden when the person signs in.
/// </summary>
public partial class MainWindow : Window
{
    public const string WindowTitle = "Seven Friends";
    private const string AppUrl = "https://sevenfriends.web.app";
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string RunName = "SevenFriends";

    /// <summary>Pages that may open INSIDE the app (the app itself and the pages of the sign-in popup). Every other link opens in the browser.</summary>
    private static readonly string[] Inside = ["sevenfriends.web.app", "sevenfriends.io", "7friends.io", "accounts.google.com", "firebaseapp.com"];

    private readonly System.Windows.Forms.NotifyIcon _tray = new();
    private readonly bool _startHidden;
    private bool _quit;
    /// <summary>The notification last shown from the web app: a click on its toast tells the page, which opens the right conversation.</summary>
    private CoreWebView2Notification? _lastNotification;

    public MainWindow(bool startHidden)
    {
        _startHidden = startHidden;
        InitializeComponent();
        Title = WindowTitle;
        if (startHidden)
        {
            // never seen: out of the screen and see-through until it hides itself (a window must be shown once to start the web view)
            Opacity = 0;
            ShowInTaskbar = false;
            WindowStartupLocation = WindowStartupLocation.Manual;
            Left = Top = -32000;
        }
        SetUpTray();
        Application.Current.SessionEnding += (_, _) => _quit = true; // Windows is shutting down
        Loaded += async (_, _) =>
        {
            await StartAsync();
            if (_startHidden) Hide();
        };
    }

    // ------------------------------------------------------------------ the tray icon

    private void SetUpTray()
    {
        _tray.Icon = System.Drawing.Icon.ExtractAssociatedIcon(Environment.ProcessPath!);
        _tray.Text = WindowTitle;
        _tray.Visible = true;
        _tray.MouseClick += (_, e) =>
        {
            if (e.Button == System.Windows.Forms.MouseButtons.Left) ShowApp();
        };
        _tray.BalloonTipClicked += (_, _) =>
        {
            _lastNotification?.ReportClicked();
            ShowApp();
        };

        var menu = new System.Windows.Forms.ContextMenuStrip();
        menu.Items.Add("Open Seven Friends", null, (_, _) => ShowApp());
        var autostart = new System.Windows.Forms.ToolStripMenuItem("Start with Windows") { CheckOnClick = true, Checked = StartsWithWindows() };
        autostart.CheckedChanged += (_, _) => SetStartsWithWindows(autostart.Checked);
        menu.Items.Add(autostart);
        menu.Items.Add(new System.Windows.Forms.ToolStripSeparator());
        menu.Items.Add("Quit", null, (_, _) => Quit());
        _tray.ContextMenuStrip = menu;
    }

    private static bool StartsWithWindows()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey);
        return key?.GetValue(RunName) is not null;
    }

    private static void SetStartsWithWindows(bool on)
    {
        using var key = Registry.CurrentUser.CreateSubKey(RunKey);
        if (on) key.SetValue(RunName, $"\"{Environment.ProcessPath}\" --tray");
        else key.DeleteValue(RunName, throwOnMissingValue: false);
    }

    /// <summary>Brings the window forward (also from the tray, or when a second copy is started).</summary>
    public void ShowApp()
    {
        if (!IsVisible)
        {
            Opacity = 1;
            ShowInTaskbar = true;
            if (Left < -10000) // it was started hidden: put it in the middle of the screen
            {
                var area = SystemParameters.WorkArea;
                Left = area.Left + (area.Width - Width) / 2;
                Top = area.Top + (area.Height - Height) / 2;
            }
            Show();
        }
        if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
        Activate();
    }

    private void Quit()
    {
        _quit = true;
        _tray.Visible = false; // else the icon stays in the tray until the mouse passes it
        _tray.Dispose();
        Application.Current.Shutdown();
    }

    /// <summary>The close button: to the tray, the app keeps running. The first time, it says so.</summary>
    protected override void OnClosing(CancelEventArgs e)
    {
        if (_quit) return;
        e.Cancel = true;
        Hide();
        var told = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SevenFriends", "tray-told");
        if (File.Exists(told)) return;
        _tray.ShowBalloonTip(5000, WindowTitle, "Seven Friends keeps running here, so you still get your messages. Right-click this icon to quit.", System.Windows.Forms.ToolTipIcon.Info);
        Directory.CreateDirectory(Path.GetDirectoryName(told)!);
        File.WriteAllText(told, "1");
    }

    // ------------------------------------------------------------------ the web app

    private static bool IsInside(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)) return false;
        if (uri.Scheme is "about" or "blob" or "data") return true;
        return uri.Scheme == Uri.UriSchemeHttps && Inside.Any(h => uri.Host == h || uri.Host.EndsWith("." + h));
    }

    /// <summary>A link that leaves the app: opened in the browser (or the mail / phone app). Nothing else is ever started.</summary>
    private static void OpenOutside(string url)
    {
        if (Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https" or "mailto" or "tel")
            Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
    }

    private async Task StartAsync()
    {
        try
        {
            // the sign-in and the settings of the app are kept here, so the person stays signed in
            var data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SevenFriends", "WebView2");
            await Web.EnsureCoreWebView2Async(await CoreWebView2Environment.CreateAsync(null, data));
        }
        catch (WebView2RuntimeNotFoundException)
        {
            MessageBox.Show("Seven Friends needs the Microsoft Edge WebView2 Runtime (it is part of Windows 11 and of Microsoft Edge).\n\nInstall it from https://go.microsoft.com/fwlink/p/?LinkId=2124703 and start the app again.",
                WindowTitle, MessageBoxButton.OK, MessageBoxImage.Information);
            Quit();
            return;
        }

        var web = Web.CoreWebView2;
        web.Settings.AreDevToolsEnabled = false;
        web.Settings.IsStatusBarEnabled = false;
        // the web app tells the Windows app from the browser by this name (it then skips the welcome page, which is the install step)
        web.Settings.UserAgent += " SevenFriendsWindows/1.0";
        // the name of this computer, for the list of keys (device-name.ts reads it from the user agent)
        web.Settings.UserAgent += " SevenFriendsDevice/" + Uri.EscapeDataString(Environment.MachineName);

        // a popup (the sign-in) opens in a small window of the app; any other new window goes to the browser
        web.NewWindowRequested += (_, e) =>
        {
            if (IsInside(e.Uri)) return;
            e.Handled = true;
            OpenOutside(e.Uri);
        };
        // the main window never leaves the app
        web.NavigationStarting += (_, e) =>
        {
            if (IsInside(e.Uri)) return;
            e.Cancel = true;
            OpenOutside(e.Uri);
        };
        // the microphone (voice messages), the camera (photos, video), notifications and reading the clipboard (the "Paste" of an invitation): for the app's own pages only
        web.PermissionRequested += (_, e) =>
        {
            var ours = Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri) && Inside.Take(3).Contains(uri.Host);
            e.State = ours && e.PermissionKind is CoreWebView2PermissionKind.Microphone or CoreWebView2PermissionKind.Camera or CoreWebView2PermissionKind.Notifications or CoreWebView2PermissionKind.ClipboardRead
                ? CoreWebView2PermissionState.Allow
                : CoreWebView2PermissionState.Deny;
        };
        // a notification of the web app (a new message, a friend request): shown by Windows from the tray icon, also while the window is hidden
        web.NotificationReceived += (_, e) =>
        {
            e.Handled = true;
            e.Notification.ReportShown();
            _lastNotification = e.Notification;
            _tray.ShowBalloonTip(8000, e.Notification.Title, e.Notification.Body, System.Windows.Forms.ToolTipIcon.None);
        };

        web.Navigate(AppUrl);
    }
}
