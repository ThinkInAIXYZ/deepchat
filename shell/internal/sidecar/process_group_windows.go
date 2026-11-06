//go:build windows

package sidecar

import (
	"errors"
	"fmt"
	"os/exec"
	"unsafe"

	"golang.org/x/sys/windows"
)

func configureProcessGroup(cmd *exec.Cmd) {}

// newProcessGroup keeps ownership after the direct child has exited. taskkill
// by root PID cannot reliably clean a tree whose root no longer exists.
func newProcessGroup(cmd *exec.Cmd) (func() error, error) {
	if cmd == nil || cmd.Process == nil {
		return nil, errors.New("sidecar process must be started before joining a job")
	}
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return nil, fmt.Errorf("create sidecar job: %w", err)
	}
	fail := func(cause error) (func() error, error) {
		return nil, errors.Join(cause, windows.CloseHandle(job))
	}
	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{
		BasicLimitInformation: windows.JOBOBJECT_BASIC_LIMIT_INFORMATION{
			LimitFlags: windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
		},
	}
	_, err = windows.SetInformationJobObject(
		job,
		windows.JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)),
		uint32(unsafe.Sizeof(info)),
	)
	if err != nil {
		return fail(fmt.Errorf("configure sidecar job cleanup: %w", err))
	}
	process, err := windows.OpenProcess(
		windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE,
		false,
		uint32(cmd.Process.Pid),
	)
	if err != nil {
		return fail(fmt.Errorf("open sidecar process for job assignment: %w", err))
	}
	defer func() { _ = windows.CloseHandle(process) }()
	if err := windows.AssignProcessToJobObject(job, process); err != nil {
		return fail(fmt.Errorf("assign sidecar to its job: %w", err))
	}

	return func() error {
		// Process.killOnce owns this handle's single termination and close. The
		// job remains valid after the root exits, so descendants cannot escape
		// cleanup merely by outliving it or by holding an inherited stdout pipe.
		terminateErr := windows.TerminateJobObject(job, 1)
		closeErr := windows.CloseHandle(job)
		return errors.Join(terminateErr, closeErr)
	}, nil
}
