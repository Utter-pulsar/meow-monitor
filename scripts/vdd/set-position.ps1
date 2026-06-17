# Move the virtual display (identified by its WxH mode) to (X,Y) in virtual-desktop coordinates.
# Uses ChangeDisplaySettingsEx with the documented two-pass (CDS_UPDATEREGISTRY|CDS_NORESET, then
# a NULL apply) so the move is atomic. No elevation needed (per-user display change).
param([int]$X = 0, [int]$Y = 0, [int]$Width = 1920, [int]$Height = 464)
$ErrorActionPreference = 'Stop'

$sig = @'
using System;
using System.Runtime.InteropServices;
public static class DisplayPos {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct DISPLAY_DEVICE {
    public int cb;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)]  public string DeviceName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string DeviceString;
    public int StateFlags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string DeviceID;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string DeviceKey;
  }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct DEVMODE {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmDeviceName;
    public ushort dmSpecVersion; public ushort dmDriverVersion; public ushort dmSize; public ushort dmDriverExtra;
    public uint dmFields;
    public int dmPositionX; public int dmPositionY;          // POINTL dmPosition (display union)
    public uint dmDisplayOrientation; public uint dmDisplayFixedOutput;
    public short dmColor; public short dmDuplex; public short dmYResolution; public short dmTTOption; public short dmCollate;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmFormName;
    public ushort dmLogPixels; public uint dmBitsPerPel; public uint dmPelsWidth; public uint dmPelsHeight;
    public uint dmDisplayFlags; public uint dmDisplayFrequency;
    public uint dmICMMethod; public uint dmICMIntent; public uint dmMediaType; public uint dmDitherType;
    public uint dmReserved1; public uint dmReserved2; public uint dmPanningWidth; public uint dmPanningHeight;
  }
  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  public static extern bool EnumDisplayDevices(string lpDevice, uint iDevNum, ref DISPLAY_DEVICE lpDisplayDevice, uint dwFlags);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  public static extern bool EnumDisplaySettings(string lpszDeviceName, int iModeNum, ref DEVMODE lpDevMode);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  public static extern int ChangeDisplaySettingsEx(string lpszDeviceName, ref DEVMODE lpDevMode, IntPtr hwnd, uint dwflags, IntPtr lParam);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  public static extern int ChangeDisplaySettingsEx(string lpszDeviceName, IntPtr lpDevMode, IntPtr hwnd, uint dwflags, IntPtr lParam);
  public const int ENUM_CURRENT_SETTINGS = -1;
  public const uint DM_POSITION = 0x20;
  public const uint CDS_UPDATEREGISTRY = 0x01;
  public const uint CDS_NORESET = 0x10000000;

  public static string Find(int w, int h) {
    DISPLAY_DEVICE dd = new DISPLAY_DEVICE(); dd.cb = Marshal.SizeOf(dd);
    for (uint i = 0; EnumDisplayDevices(null, i, ref dd, 0); i++) {
      DEVMODE dm = new DEVMODE(); dm.dmSize = (ushort)Marshal.SizeOf(typeof(DEVMODE));
      if (EnumDisplaySettings(dd.DeviceName, ENUM_CURRENT_SETTINGS, ref dm) && dm.dmPelsWidth == w && dm.dmPelsHeight == h)
        return dd.DeviceName;
      dd.cb = Marshal.SizeOf(dd);
    }
    return null;
  }
  public static int Move(string dev, int x, int y) {
    DEVMODE dm = new DEVMODE(); dm.dmSize = (ushort)Marshal.SizeOf(typeof(DEVMODE));
    if (!EnumDisplaySettings(dev, ENUM_CURRENT_SETTINGS, ref dm)) return -100;
    dm.dmFields = DM_POSITION; dm.dmPositionX = x; dm.dmPositionY = y;
    int r = ChangeDisplaySettingsEx(dev, ref dm, IntPtr.Zero, CDS_UPDATEREGISTRY | CDS_NORESET, IntPtr.Zero);
    if (r != 0) return r;
    return ChangeDisplaySettingsEx((string)null, IntPtr.Zero, IntPtr.Zero, 0, IntPtr.Zero); // apply
  }
}
'@
Add-Type -TypeDefinition $sig -Language CSharp

$dev = [DisplayPos]::Find($Width, $Height)
if (-not $dev) { Write-Output 'ERR no-display'; exit 2 }
$r = [DisplayPos]::Move($dev, $X, $Y)
Write-Output "device=$dev result=$r"
if ($r -ne 0) { exit 3 }
