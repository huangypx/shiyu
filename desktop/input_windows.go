package desktop

import (
	"errors"
	"os"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"unsafe"

	"github.com/go-ole/go-ole"
	"github.com/wailsapp/wails/v3/pkg/w32"
)

var (
	clsidAutomation8 = ole.NewGUID("{e22ad333-b25f-460c-83d0-0581107395c9}")
	iidAutomation2   = ole.NewGUID("{34723aff-0c9d-49d0-9896-7ab52df8cd8a}")
	iidTextPattern2  = ole.NewGUID("{506a921a-fcc9-409f-b23b-37eb74106872}")
)

// 这些槽位来自 Windows SDK 的 UIAutomationClient.h，包括基类 IUnknown 的三个方法。
const (
	getFocusedElement         = 8
	getRawViewWalker          = 16
	putConnectionTimeout      = 61
	putTransactionTimeout     = 63
	getParentElement          = 3
	getRuntimeID              = 4
	getCurrentPropertyValueEx = 11
	getCurrentPatternAs       = 14
	getCaretRange             = 10
	getRangeAttributeValue    = 9
	getRangeEnclosingElement  = 11
)

// UI Automation 属性、控件与模式标识使用 Windows SDK 的固定值。
const (
	uiaControlType       = 30003
	uiaEnabled           = 30010
	uiaPassword          = 30019
	uiaValueReadOnly     = 30046
	uiaLegacyRole        = 30095
	uiaLegacyState       = 30096
	uiaAriaRole          = 30101
	uiaAriaProperties    = 30102
	uiaTextEditAvailable = 30149
	uiaTextPattern2      = 10024
	uiaReadOnlyAttribute = 40015
	uiaComboBox          = 50003
	uiaEdit              = 50004
	uiaSpinner           = 50016
	uiaText              = 50020
	uiaCustom            = 50025
	uiaGroup             = 50026
	uiaDocument          = 50030
	uiaPane              = 50033
	roleSystemText       = 42
	stateUnavailable     = 0x1
	stateReadOnly        = 0x40
	stateProtected       = 0x20000000
)

type automationObject struct{ ole.IUnknown }

func (o *automationObject) method(slot int) uintptr {
	return unsafe.Slice((*uintptr)(unsafe.Pointer(o.RawVTable)), slot+1)[slot]
}

func (o *automationObject) object(slot int) *automationObject {
	var result *automationObject
	hr, _, _ := syscall.SyscallN(o.method(slot), uintptr(unsafe.Pointer(o)), uintptr(unsafe.Pointer(&result)))
	if int32(hr) < 0 {
		return nil
	}
	return result
}

func (o *automationObject) parentOf(element *automationObject) *automationObject {
	var parent *automationObject
	hr, _, _ := syscall.SyscallN(o.method(getParentElement), uintptr(unsafe.Pointer(o)),
		uintptr(unsafe.Pointer(element)), uintptr(unsafe.Pointer(&parent)))
	if int32(hr) < 0 {
		return nil
	}
	return parent
}

func (o *automationObject) property(id uintptr) any {
	var v ole.VARIANT
	// 忽略默认值，以区分「确实可写」与「服务商没有提供只读属性」。
	hr, _, _ := syscall.SyscallN(o.method(getCurrentPropertyValueEx), uintptr(unsafe.Pointer(o)),
		id, 1, uintptr(unsafe.Pointer(&v)))
	defer v.Clear()
	if int32(hr) >= 0 {
		switch v.VT {
		case ole.VT_I4, ole.VT_UI4:
			return uint32(v.Val)
		case ole.VT_BOOL:
			return int16(v.Val) != 0
		case ole.VT_BSTR:
			return v.ToString()
		}
	}
	return nil
}

func (o *automationObject) runtimeID() string {
	var array *ole.SafeArray
	hr, _, _ := syscall.SyscallN(o.method(getRuntimeID), uintptr(unsafe.Pointer(o)), uintptr(unsafe.Pointer(&array)))
	if int32(hr) < 0 || array == nil {
		return ""
	}
	ids := ole.SafeArrayConversion{Array: array}
	defer ids.Release()
	var parts []string
	for _, value := range ids.ToValueArray() {
		id, ok := value.(int32)
		if !ok {
			return ""
		}
		parts = append(parts, strconv.FormatInt(int64(id), 10))
	}
	return strings.Join(parts, ".")
}

// writableCaret 查询插入点自己的只读属性，富文本文档的整体属性可能是混合值。
func (o *automationObject) writableCaret() *automationObject {
	var pattern *automationObject
	hr, _, _ := syscall.SyscallN(o.method(getCurrentPatternAs), uintptr(unsafe.Pointer(o)),
		uiaTextPattern2, uintptr(unsafe.Pointer(iidTextPattern2)), uintptr(unsafe.Pointer(&pattern)))
	if int32(hr) < 0 || pattern == nil {
		return nil
	}
	defer pattern.Release()
	var active int32
	var caret *automationObject
	hr, _, _ = syscall.SyscallN(pattern.method(getCaretRange), uintptr(unsafe.Pointer(pattern)),
		uintptr(unsafe.Pointer(&active)), uintptr(unsafe.Pointer(&caret)))
	if int32(hr) < 0 || caret == nil {
		return nil
	}
	defer caret.Release()
	if active == 0 {
		return nil
	}
	var readOnly ole.VARIANT
	hr, _, _ = syscall.SyscallN(caret.method(getRangeAttributeValue), uintptr(unsafe.Pointer(caret)), uiaReadOnlyAttribute,
		uintptr(unsafe.Pointer(&readOnly)))
	defer readOnly.Clear()
	if int32(hr) < 0 || readOnly.VT != ole.VT_BOOL || int16(readOnly.Val) != 0 {
		return nil
	}
	return caret.object(getRangeEnclosingElement)
}

func (o *automationObject) unavailable() bool {
	state, _ := o.property(uiaLegacyState).(uint32)
	// 旧式辅助功能把密码和禁用状态放进状态位，网页编辑框还会公开独立属性。
	return state&(stateProtected|stateUnavailable) != 0 || o.property(uiaPassword) == true || o.property(uiaEnabled) == false
}

func editableRuntimeID(element, walker *automationObject, depth int) string {
	if element == nil {
		return ""
	}
	defer element.Release()
	if depth == 0 || element.unavailable() {
		return ""
	}
	kind, _ := element.property(uiaControlType).(uint32)
	role, _ := element.property(uiaAriaRole).(string)
	legacyRole, _ := element.property(uiaLegacyRole).(uint32)
	state, hasState := element.property(uiaLegacyState).(uint32)
	readOnly := element.property(uiaValueReadOnly)
	richEditor := role == "textbox" || role == "searchbox" || element.property(uiaTextEditAvailable) == true
	valueEditor := readOnly == false && (kind == uiaComboBox || kind == uiaSpinner || kind == uiaDocument)
	if richEditor || kind == uiaEdit || legacyRole == roleSystemText || valueEditor {
		properties, _ := element.property(uiaAriaProperties).(string)
		if readOnly == true || state&stateReadOnly != 0 || strings.Contains(strings.ToLower(properties), "readonly=true") {
			return ""
		}
		if richEditor || readOnly == false || hasState {
			return element.runtimeID()
		}
	}
	switch kind {
	case uiaDocument:
		// 浏览器有时把焦点报告给文档。只认可实际激活且可写的插入点。
		if caret := element.writableCaret(); caret != nil {
			defer caret.Release()
			if !caret.unavailable() {
				return caret.runtimeID()
			}
		}
	case uiaText, uiaCustom, uiaGroup, uiaPane:
		// 富文本编辑器也可能把焦点交给内部段落，身份以所属的编辑框为准。
		if walker != nil {
			return editableRuntimeID(walker.parentOf(element), walker, depth-1)
		}
	}
	return ""
}

func focusedInputTarget() string {
	window := w32.GetForegroundWindow()
	_, pid := w32.GetWindowThreadProcessId(window)
	if window == 0 || pid == 0 || pid == os.Getpid() {
		return ""
	}
	switch w32.GetClassName(window) {
	case "Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd":
		return ""
	}
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	if err := ole.CoInitializeEx(0, ole.COINIT_MULTITHREADED); err != nil {
		var result *ole.OleError
		if !errors.As(err, &result) || result.Code() != 1 {
			return ""
		}
	}
	defer ole.CoUninitialize()
	client, err := ole.CreateInstance(clsidAutomation8, iidAutomation2)
	if err != nil {
		return ""
	}
	defer client.Release()
	automation := (*automationObject)(unsafe.Pointer(client))
	syscall.SyscallN(automation.method(putConnectionTimeout), uintptr(unsafe.Pointer(automation)), 500)
	syscall.SyscallN(automation.method(putTransactionTimeout), uintptr(unsafe.Pointer(automation)), 500)
	walker := automation.object(getRawViewWalker)
	if walker != nil {
		defer walker.Release()
	}
	id := editableRuntimeID(automation.object(getFocusedElement), walker, 8)
	if id == "" || w32.GetForegroundWindow() != window {
		return ""
	}
	return strconv.FormatUint(uint64(window), 10) + "/" + id
}
