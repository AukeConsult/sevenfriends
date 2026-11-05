using System.Diagnostics;
using System.IO;
using System.Windows;
using Microsoft.Web.WebView2.Core;

namespace SevenFriends;

/// <summary>
/// Shows the live web app (the same address as server.url in frontend/capacitor.config.json: change both together).
/// The web app stays the one code base: deploy it and this window shows the new version, nothing to rebuild.
/// </summary>
public partial class MainWindow : Window
{
    public const string WindowTitle = "Seven Friends";
    private const string AppUrl = "https://sevenfriends.web.app";

    /// <summary>Pages that may open INSIDE the app (the app itself and the pages of the sign-in popup). Every other link opens in the browser.</summary>
    private static readonly string[] Inside = ["sevenfriends.web.app", "sevenfriends.io", "7friends.io", "accounts.google.com", "firebaseapp.com"];

    public MainWindow()
    {
        InitializeComponent();
        Title = WindowTitle;
        Loaded += async (_, _) => await StartAsync();
    }

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
            Close();
            return;
        }

        var web = Web.CoreWebView2;
        web.Settings.AreDevToolsEnabled = false;
        web.Settings.IsStatusBarEnabled = false;

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
        // the microphone (voice messages), the camera (photos, video) and notifications: for the app's own pages only
        web.PermissionRequested += (_, e) =>
        {
            var ours = Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri) && Inside.Take(3).Contains(uri.Host);
            e.State = ours && e.PermissionKind is CoreWebView2PermissionKind.Microphone or CoreWebView2PermissionKind.Camera or CoreWebView2PermissionKind.Notifications
                ? CoreWebView2PermissionState.Allow
                : CoreWebView2PermissionState.Deny;
        };

        web.Navigate(AppUrl);
    }
}
