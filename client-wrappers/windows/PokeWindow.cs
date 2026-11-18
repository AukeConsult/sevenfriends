using System;
using System.Media;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;

namespace SevenFriends;

/// <summary>
/// The alarm of a poke (docs/design/poke-alarm.md). A window over everything else, also over a full-screen program, that says WHO is poking and the text, with a sound that
/// repeats until the person presses Stop or Open (or after two minutes). It works while the main window is hidden in the tray: the web page, which keeps running there,
/// tells the app about the poke (<see cref="MainWindow"/> reads the message). It is made in code, no XAML.
/// </summary>
public sealed class PokeWindow : Window
{
    private const int MaxSeconds = 120;
    private readonly TextBlock _name = new();
    private readonly TextBlock _text = new();
    private readonly DispatcherTimer _sound = new() { Interval = TimeSpan.FromMilliseconds(1400) };
    private readonly DispatcherTimer _giveUp = new() { Interval = TimeSpan.FromSeconds(MaxSeconds) };
    private string _url = "/";

    /// <summary>"Open": the person wants that friend's page; the main window is brought forward on it.</summary>
    private readonly Action<string> _open;

    public PokeWindow(Action<string> open)
    {
        _open = open;
        Title = "Seven Friends · Poke";
        WindowStyle = WindowStyle.None;
        ResizeMode = ResizeMode.NoResize;
        Topmost = true;
        ShowInTaskbar = true;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        Width = 460;
        SizeToContent = SizeToContent.Height;
        Background = new SolidColorBrush(Color.FromRgb(0x2F, 0x4B, 0x7C));

        var panel = new StackPanel { Margin = new Thickness(28) };
        panel.Children.Add(new TextBlock { Text = "Poke from", Foreground = new SolidColorBrush(Color.FromArgb(0xCC, 255, 255, 255)), FontSize = 16, HorizontalAlignment = HorizontalAlignment.Center });
        _name.Foreground = Brushes.White;
        _name.FontSize = 34;
        _name.FontWeight = FontWeights.Bold;
        _name.TextWrapping = TextWrapping.Wrap;
        _name.TextAlignment = TextAlignment.Center;
        panel.Children.Add(_name);
        _text.Foreground = Brushes.White;
        _text.FontSize = 18;
        _text.TextWrapping = TextWrapping.Wrap;
        _text.TextAlignment = TextAlignment.Center;
        _text.Margin = new Thickness(0, 8, 0, 0);
        panel.Children.Add(_text);
        panel.Children.Add(Button("Stop", (_, _) => Close()));
        panel.Children.Add(Button("Open", (_, _) =>
        {
            var url = _url;
            Close();
            _open(url);
        }));
        Content = panel;

        _sound.Tick += (_, _) => SystemSounds.Exclamation.Play();
        _giveUp.Tick += (_, _) => Close();
        Closed += (_, _) =>
        {
            _sound.Stop();
            _giveUp.Stop();
        };
    }

    private static Button Button(string text, RoutedEventHandler click)
    {
        var button = new Button { Content = text, Height = 48, FontSize = 18, Margin = new Thickness(0, 14, 0, 0) };
        button.Click += click;
        return button;
    }

    /// <summary>Shows (or updates, when another poke comes while one rings) the alarm and starts the sound.</summary>
    public void Ring(string name, string text, string url)
    {
        _name.Text = string.IsNullOrWhiteSpace(name) ? "Seven Friends" : name;
        _text.Text = text;
        _text.Visibility = string.IsNullOrWhiteSpace(text) ? Visibility.Collapsed : Visibility.Visible;
        _url = url;
        if (!IsVisible) Show();
        Topmost = false; // off and on again: Windows then puts the window in front of the others
        Topmost = true;
        Activate();
        SystemSounds.Exclamation.Play();
        _sound.Stop();
        _sound.Start();
        _giveUp.Stop();
        _giveUp.Start();
    }
}
