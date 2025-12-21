import React from 'react'
import { Modal, ButtonProps } from 'antd'

interface ConfirmationModalProps {
  visible: boolean
  message: string
  okText: string
  cancelText?: string
  okButtonProps?: ButtonProps
  onConfirm: () => void
  onCancel: () => void
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  visible,
  message,
  okText,
  cancelText = 'Cancel',
  okButtonProps,
  onConfirm,
  onCancel
}) => {
  return (
    <Modal
      open={visible}
      onOk={onConfirm}
      onCancel={onCancel}
      okText={okText}
      cancelText={cancelText}
      okButtonProps={okButtonProps}
      centered
      maskClosable={false}
    >
      <p>{message}</p>
    </Modal>
  )
}



